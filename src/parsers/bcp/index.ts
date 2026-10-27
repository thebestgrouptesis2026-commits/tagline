import type { TxnKind } from "@/domain/ledger";
import { currencyFromLabel, foldKey, lastFour, normalizeText, parseKeyValues, parseLimaDateTime, parseMoney } from "../normalize";
import { clampConfidence, type BankParser, type ParseResult } from "../types";

/**
 * Constancias de BCP por correo ("BCP Comunica <bcpcomunica@email.bcp.com.pe>").
 * Formato: tabla de líneas "Clave: valor" entre separadores.
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
const SENDER = /@(?:[a-z0-9-]+\.)*bcp\.com\.pe>?\s*$/i;
const SALARY_WORDS = ["PLANILLA", "HABERES", "REMUNERACION"];

export const bcpParser: BankParser = {
  id: "bcp-email",
  version: 1,

  canParse(input) {
    return input.source !== "manual" && (SENDER.test(input.sender) || /Banco de Cr[eé]dito BCP/i.test(input.rawText));
  },

  parse(input): ParseResult {
    const text = normalizeText(input.rawText);
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
