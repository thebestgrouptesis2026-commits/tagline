import { currencyFromLabel, foldKey, normalizeText, parseKeyValues, parseLimaTextDate, parseMoney } from "../normalize";
import { clampConfidence, type BankParser, type ParseResult } from "../types";

/**
 * Constancias de Interbank por correo. Verificado con "Constancia de Pago Plin" (líneas "Clave: valor",
 * fecha suelta tipo "12 Nov 2025 11:28 AM", cuenta de cargo en dos líneas: nombre y número).
 * Otras constancias (consumos de la Visa, transferencias, pagos de servicios) no tienen ejemplo real
 * todavía: se reconocen como "unrecognized" y van a la bandeja de revisión.
 */
const SENDER = /@(?:[a-z0-9-]+\.)*interbank\.pe>?\s*$/i;

export const interbankParser: BankParser = {
  id: "interbank-email",
  version: 1,

  canParse(input) {
    return input.source !== "manual" && (SENDER.test(input.sender) || /\bInterbank\b/i.test(input.rawText));
  },

  parse(input): ParseResult {
    const text = normalizeText(input.rawText);
    const kv = parseKeyValues(text);
    const title = /constancia de ([^\n]+)/i.exec(text)?.[1] ?? "";
    const amount = parseMoney(kv.get("moneda y monto") ?? "");

    if (!title && !amount) return { ok: false, reason: "not_a_movement" };
    if (!/^pago plin/i.test(foldKey(title))) {
      return { ok: false, reason: "unrecognized", detail: `constancia desconocida: ${title || "(sin título)"}` };
    }
    if (!amount) return { ok: false, reason: "unrecognized", detail: "sin monto" };

    const warnings: string[] = [];
    let confidence = 1;

    const dateLine = /\d{1,2}\s+[A-Za-zñÑ]{3,10}\.?\s+\d{4}\s+\d{1,2}:\d{2}\s*[AP]\.?M\.?/i.exec(text)?.[0];
    const occurredAt = dateLine ? parseLimaTextDate(dateLine) : null;
    if (!occurredAt) {
      confidence -= 0.1;
      warnings.push("sin_fecha");
    }

    // "Cuenta cargo: Cuenta Simple Soles" + línea siguiente "898 3330001234".
    const cargo = /cuenta cargo:\s*([^\n]+)(?:\n\s*([\d ]{8,}))?/i.exec(text);
    const last4 = cargo?.[2]?.replace(/\D/g, "").slice(-4) || null;
    if (!last4) {
      confidence -= 0.3;
      warnings.push("sin_cuenta");
    }

    const holder = kv.get("destinatario") ?? null;
    const destino = kv.get("destino") ?? "";
    // Yape es del BCP: un Plin hacia Yape termina en una cuenta BCP.
    const destinationBank = /yape/i.test(destino) ? "bcp" : null;

    return {
      ok: true,
      confidence: clampConfidence(confidence),
      movement: {
        kind: "transfer_out",
        amountMinor: amount.amountMinor,
        currency: amount.currency,
        occurredAt: occurredAt ?? input.receivedAt,
        merchant: holder,
        account: {
          bank: "interbank",
          last4,
          type: null,
          currency: (cargo && currencyFromLabel(cargo[1]!)) || amount.currency,
        },
        counterparty: { last4: null, label: destino || "Plin", bank: destinationBank, holder },
        categoryHint: null,
        reference: kv.get("codigo de operacion") ?? null,
        keywords: [],
        warnings,
      },
    };
  },
};
