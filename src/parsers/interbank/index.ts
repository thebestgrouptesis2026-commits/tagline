import { currencyFromLabel, foldKey, normalizeText, parseKeyValues, parseLabelBlocks, parseLimaTextDate, parseMoney } from "../normalize";
import { clampConfidence, type BankParser, type ParseResult } from "../types";

/**
 * Constancias de Interbank por correo. Verificado con "Constancia de Pago Plin" en dos formatos reales:
 * - 2025: líneas "Clave: valor" y "Moneda y monto".
 * - Oct 2026: tabla "Etiqueta / valor" sin dos puntos, "Monto y moneda" y la cuenta de cargo en varias
 *   líneas ("Cuenta Simple", "Soles", "898 3330001234").
 * Otras constancias (consumos de la Visa, transferencias, pagos de servicios) no tienen ejemplo real
 * todavía: se reconocen como "unrecognized" y van a la bandeja de revisión.
 */
// Remitente real: "Interbank Servicio al Cliente <servicioalcliente@netinterbank.com.pe>".
const SENDER = /@(?:[a-z0-9-]+\.)*(?:net)?interbank\.(?:com\.)?pe>?\s*$/i;

const LABELS = ["Código de operación", "Fecha y hora", "Cuenta cargo", "Destinatario", "Destino", "Monto y moneda", "Moneda y monto"] as const;

export const interbankParser: BankParser = {
  id: "interbank-email",
  version: 2,

  canParse(input) {
    return input.source !== "manual" && (SENDER.test(input.sender) || /\bInterbank\b/i.test(input.rawText));
  },

  parse(input): ParseResult {
    const text = normalizeText(input.rawText);
    // Primero "Clave: valor"; lo que falte se busca como tabla (etiqueta y valor sin dos puntos).
    const colon = parseKeyValues(text);
    const table = parseLabelBlocks(text, LABELS);
    const kv = { get: (key: string) => colon.get(key) ?? table.get(key) };
    const title = /constancia de ([^\n]+)/i.exec(text)?.[1] ?? "";
    const amount = parseMoney(kv.get("moneda y monto") ?? kv.get("monto y moneda") ?? "");

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

    // Todo lo que hay entre "Cuenta cargo" y la siguiente etiqueta: nombre, moneda y número (en 1 a 3 líneas).
    const cargo = /cuenta cargo:?\s*([\s\S]*?)(?=\n\s*(?:destinatario|destino|monto|moneda|c[oó]digo)\b|$)/i.exec(text)?.[1] ?? "";
    const last4 = /\d[\d ]{7,}/.exec(cargo)?.[0].replace(/\D/g, "").slice(-4) || null;
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
          currency: currencyFromLabel(cargo) || amount.currency,
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
