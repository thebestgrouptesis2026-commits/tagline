import type { TxnKind } from "@/domain/ledger";
import {
  currencyFromLabel,
  foldKey,
  lastFour,
  normalizeText,
  parseKeyValues,
  parseLabelBlocks,
  parseLimaDateTime,
  parseLimaTextDate,
  parseMoney,
} from "../normalize";
import { clampConfidence, type BankParser, type ParseResult } from "../types";

/**
 * Correos de BCP. Dos formatos:
 * - Constancias ("BCP Comunica <bcpcomunica@email.bcp.com.pe>"): líneas "Clave: valor".
 * - Notificaciones ("BCP Notificaciones <notificaciones@notificacionesbcp.com.pe>"): titular
 *   "Realizaste un consumo de S/ X con tu Tarjeta de Débito…" y tabla "Etiqueta  Valor" sin dos puntos.
 *
 * `verified` = el formato se validó con un correo real. Los no verificados restan
 * confianza para que vayan a revisión hasta tener un ejemplo real en fixtures/.
 */
const OPERATIONS: ReadonlyArray<{ test: RegExp; kind: TxnKind; verified: boolean }> = [
  { test: /transferencia a terceros/, kind: "transfer_out", verified: true },
  { test: /transferencia (entre|a) (mis|tus) cuentas|transferencia propia/, kind: "transfer_out", verified: false },
  { test: /transferencia (interbancaria )?recibida|abono (por|de) transferencia/, kind: "transfer_in", verified: false },
  { test: /pago de tarjeta/, kind: "card_payment", verified: false },
  { test: /planilla|haberes|remuneraci/, kind: "salary", verified: false },
  { test: /abono|deposito/, kind: "deposit", verified: false },
  { test: /compra|consumo/, kind: "purchase", verified: false },
  { test: /retiro/, kind: "cash_withdrawal", verified: false },
];

const INCOMING: ReadonlySet<TxnKind> = new Set(["transfer_in", "salary", "deposit", "refund"]);
const SENDER = /@(?:[a-z0-9-]+\.)*(?:notificaciones)?bcp\.com\.pe>?\s*$/i;
const SALARY_WORDS = ["PLANILLA", "HABERES", "REMUNERACION"];

export const bcpParser: BankParser = {
  id: "bcp-email",
  version: 2,

  canParse(input) {
    return input.source !== "manual" && (SENDER.test(input.sender) || /Banco de Cr[eé]dito BCP/i.test(input.rawText));
  },

  parse(input): ParseResult {
    const text = normalizeText(input.rawText);
    // El titular de las notificaciones lleva el monto ("Realizaste un consumo de S/ 88.31 …").
    if (/^(realizaste un (consumo|yapeo)[^\n]* de|recibiste un yape[^\n]* de) (S\/|US\$)/im.test(text)) {
      return parseNotification(text, input.receivedAt);
    }
    const kv = parseKeyValues(text);
    const opRaw = kv.get("operacion") ?? kv.get("tipo de operacion");
    const amount = parseMoney(kv.get("monto") ?? kv.get("importe") ?? kv.get("monto total") ?? "");

    if (!opRaw && !amount) return { ok: false, reason: "not_a_movement" };
    if (!amount) return { ok: false, reason: "unrecognized", detail: "sin monto" };

    const op = OPERATIONS.find((o) => o.test.test(foldKey(opRaw ?? "")));
    if (!op) return { ok: false, reason: "unrecognized", detail: `operación desconocida: ${opRaw ?? "(vacía)"}` };

    const warnings: string[] = [];
    let confidence = 1;
    if (!op.verified) {
      confidence -= 0.25;
      warnings.push("formato_no_verificado");
    }

    const occurredAt = parseLimaDateTime(kv.get("fecha y hora") ?? kv.get("fecha") ?? "");
    if (!occurredAt) {
      confidence -= 0.1;
      warnings.push("sin_fecha");
    }

    const origin = kv.get("cuenta de origen") ?? kv.get("tarjeta") ?? kv.get("cuenta");
    const destination = kv.get("cuenta de destino") ?? kv.get("tarjeta de destino");
    const incoming = INCOMING.has(op.kind);
    const own = incoming ? (destination ?? origin) : origin;
    const other = incoming ? (destination ? origin : undefined) : destination;
    const ownLast4 = own ? lastFour(own) : null;
    if (!ownLast4) {
      confidence -= 0.3;
      warnings.push("sin_cuenta");
    }

    const upper = text.toUpperCase();
    const keywords = SALARY_WORDS.filter((w) => upper.includes(w));

    return {
      ok: true,
      confidence: clampConfidence(confidence),
      movement: {
        kind: op.kind,
        amountMinor: amount.amountMinor,
        currency: amount.currency,
        occurredAt: occurredAt ?? input.receivedAt,
        merchant: kv.get("beneficiario") ?? kv.get("comercio") ?? kv.get("establecimiento") ?? kv.get("ordenante") ?? null,
        account: {
          bank: "bcp",
          last4: ownLast4,
          type: null,
          currency: (own && currencyFromLabel(own)) || amount.currency,
        },
        counterparty: other ? { last4: lastFour(other), label: other } : null,
        categoryHint: null,
        reference: kv.get("nro. de operacion") ?? kv.get("numero de operacion") ?? null,
        keywords,
        warnings,
      },
    };
  },
};

const NOTIFICATION_LABELS = [
  "Operación realizada",
  "Fecha y hora",
  "Número de Tarjeta de Débito",
  "Empresa",
  "Número de operación",
  "Enviado a",
  "Monto enviado",
  "Total del consumo",
] as const;

/**
 * Notificaciones nuevas de BCP. Verificadas con correos reales: consumo con tarjeta de débito
 * y yapeo a celular. "Recibiste un yape" es una suposición (sin ejemplo real): va a revisión.
 */
function parseNotification(text: string, receivedAt: Date): ParseResult {
  const kv = parseLabelBlocks(text, NOTIFICATION_LABELS);
  const get = (label: string) => kv.get(foldKey(label));
  const headline = /^(realizaste un (?:consumo|yapeo)[^\n]*|recibiste un yape[^\n]*)/im.exec(text)?.[1] ?? "";
  const amount = parseMoney(get("Total del consumo") ?? get("Monto enviado") ?? headline);
  if (!amount) return { ok: false, reason: "unrecognized", detail: "sin monto" };

  const warnings: string[] = [];
  let confidence = 1;
  const h = foldKey(headline);
  let kind: TxnKind;
  let verified = true;
  if (h.startsWith("realizaste un consumo")) kind = "purchase";
  else if (h.startsWith("realizaste un yapeo")) kind = "transfer_out";
  else {
    kind = "transfer_in";
    verified = false;
  }
  if (!verified) {
    confidence -= 0.25;
    warnings.push("formato_no_verificado");
  }

  const occurredAt = parseLimaTextDate(get("Fecha y hora") ?? "");
  if (!occurredAt) {
    confidence -= 0.1;
    warnings.push("sin_fecha");
  }

  // Débito: "************4567". Yapeo: "desde tu Cuenta de ahorro Soles" no trae dígitos; la cuenta
  // se resuelve por banco + moneda si solo hay una candidata.
  const cardRaw = get("Número de Tarjeta de Débito");
  const last4 = cardRaw ? lastFour(cardRaw) : null;
  if (kind === "purchase" && !last4) {
    confidence -= 0.3;
    warnings.push("sin_cuenta");
  }

  const merchant = kind === "purchase" ? (get("Empresa") ?? /\ben (.+?)\.?$/i.exec(headline)?.[1] ?? null) : null;
  const recipient = get("Enviado a");
  const holder = recipient?.replace(/\s*\*[\s*\d]*$/, "").replace(/\.$/, "").trim() || null;
  const accountLabel = /desde tu (.+?)\.?$/i.exec(headline)?.[1];

  return {
    ok: true,
    confidence: clampConfidence(confidence),
    movement: {
      kind,
      amountMinor: amount.amountMinor,
      currency: amount.currency,
      occurredAt: occurredAt ?? receivedAt,
      merchant: kind === "transfer_out" ? holder : merchant,
      account: { bank: "bcp", last4, type: null, currency: (accountLabel && currencyFromLabel(accountLabel)) || amount.currency },
      counterparty: kind === "transfer_out" && recipient ? { last4: null, label: "Yape", holder } : null,
      categoryHint: null,
      reference: get("Número de operación") ?? null,
      keywords: [],
      warnings,
    },
  };
}
