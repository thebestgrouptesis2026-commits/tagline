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
  version: 3,

  canParse(input) {
    return input.source !== "manual" && (SENDER.test(input.sender) || /Banco de Cr[eé]dito BCP/i.test(input.rawText));
  },

  parse(input): ParseResult {
    const text = normalizeText(input.rawText);
    // El titular de las notificaciones lleva el monto ("Realizaste un consumo de S/ 88.31 …").
    if (NOTIFICATION_HEADLINE.test(text)) return parseNotification(text, input.receivedAt);
    // Otra notificación con monto que aún no conocemos: a revisión, nunca ignorada en silencio.
    if (/^(realizaste|recibiste)\b[^\n]*(S\/|US\$)\s?\d/im.test(text)) {
      return { ok: false, reason: "unrecognized", detail: "notificación BCP con formato desconocido" };
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
  "Enviado por",
  "Monto enviado",
  "Monto recibido",
  "Monto transferido",
  "Total del consumo",
] as const;

const NOTIFICATION_HEADLINE =
  /^(realizaste un (?:consumo|yapeo)[^\n]* de|realizaste una transferencia[^\n]* de|recibiste un yape[^\n]* de) (S\/|US\$)/im;

/**
 * Notificaciones nuevas de BCP. Verificadas con correos reales (texto de `getPlainBody()` de Gmail):
 * consumo con tarjeta de débito, yapeo a celular enviado y recibido, y transferencia a terceros.
 * La tabla de datos llega a veces aplanada en una línea ("Operación realizada … Fecha y hora … Enviado a …")
 * y los números de cuenta van en la línea siguiente a su etiqueta ("Desde Cuenta de ahorro" / "**** 1046").
 */
function parseNotification(text: string, receivedAt: Date): ParseResult {
  const kv = parseLabelBlocks(text, NOTIFICATION_LABELS);
  const get = (label: string) => kv.get(foldKey(label));
  const headline = /^(realizaste un (?:consumo|yapeo)[^\n]*|realizaste una transferencia[^\n]*|recibiste un yape[^\n]*)/im.exec(text)?.[1] ?? "";
  const amount = parseMoney(get("Total del consumo") ?? get("Monto enviado") ?? get("Monto recibido") ?? get("Monto transferido") ?? headline);
  if (!amount) return { ok: false, reason: "unrecognized", detail: "sin monto" };

  const warnings: string[] = [];
  let confidence = 1;
  const h = foldKey(headline);
  const isYapeo = h.includes("yape");
  const kind: TxnKind = h.startsWith("realizaste un consumo") ? "purchase" : h.startsWith("realizaste") ? "transfer_out" : "transfer_in";

  const dateRaw = get("Fecha y hora") ?? /fecha y hora\s+(\d{1,2} de \S+ de \d{4}\s*-\s*\d{1,2}:\d{2}\s*[AP]M)/i.exec(text)?.[1];
  const occurredAt = parseLimaTextDate(dateRaw ?? "");
  if (!occurredAt) {
    confidence -= 0.1;
    warnings.push("sin_fecha");
  }

  // Cuenta propia: tarjeta de débito ("************4567") o "Desde <producto>" + "**** 1046" en la línea siguiente.
  // Sin dígitos, la cuenta se resuelve por banco + moneda si solo hay una candidata.
  const cardRaw = get("Número de Tarjeta de Débito");
  const from = /\bdesde\s+(?!tu\b)([^\n]+?)\s*\n\s*(\*[\s*]*\d{4})\b/i.exec(text);
  const last4 = (cardRaw ? lastFour(cardRaw) : null) ?? (from ? lastFour(from[2]!) : null);
  if (kind === "purchase" && !last4) {
    confidence -= 0.3;
    warnings.push("sin_cuenta");
  }

  const merchant = kind === "purchase" ? (get("Empresa") ?? /\ben (.+?)\.?$/i.exec(headline)?.[1] ?? null) : null;
  // Enviado: "Enviado a Juan P Perez M." + "*** **3 644" (celular) o "**** 9021" (cuenta). Recibido: "Enviado por Perez Lopez Juan Pablo".
  const sentTo = /enviado a\s+([^\n*]*\p{L}[^\n*]*?)\s*\n\s*(\*[\s*\d]+)/iu.exec(text);
  const other = kind === "transfer_in" ? (get("Enviado por") ?? /\bde ([^\d]+?)\.?$/i.exec(headline)?.[1]) : (sentTo?.[1] ?? get("Enviado a"));
  // "Transferencia entre mis cuentas": el "Enviado a" es un producto tuyo ("Clasica"), no una persona.
  const ownTransfer = /transferencia entre mis cuentas/i.test(text);
  const holder = ownTransfer ? null : other?.replace(/\s*\*[\s*\d]*$/, "").replace(/\.$/, "").trim() || null;
  // Un celular ("*** **3 644") no da últimos 4 de cuenta; una cuenta destino ("**** 9021") sí.
  const otherLast4 = !isYapeo && sentTo ? lastFour(sentTo[2]!) : null;
  const accountLabel = from?.[1] ?? /desde tu (.+?)\.?$/i.exec(headline)?.[1];

  return {
    ok: true,
    confidence: clampConfidence(confidence),
    movement: {
      kind,
      amountMinor: amount.amountMinor,
      currency: amount.currency,
      occurredAt: occurredAt ?? receivedAt,
      merchant: kind === "purchase" ? merchant : holder,
      account: {
        bank: "bcp",
        last4,
        // Un yapeo recibido entra a tu cuenta Yape (la billetera de BCP); el correo no trae sus dígitos.
        type: kind === "transfer_in" && isYapeo && !last4 ? "wallet" : null,
        currency: (accountLabel && currencyFromLabel(accountLabel)) || amount.currency,
      },
      counterparty:
        kind !== "purchase" && other
          ? isYapeo
            ? { last4: null, label: "Yape", bank: "bcp", holder }
            : { last4: otherLast4, label: ownTransfer ? "Entre mis cuentas" : (holder ?? "Transferencia"), holder }
          : null,
      categoryHint: null,
      reference: /n[uú]mero de operaci[oó]n\s+(\d{4,})/i.exec(text)?.[1] ?? null,
      keywords: [],
      warnings,
    },
  };
}
