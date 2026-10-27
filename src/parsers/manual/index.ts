import { parseAmountToMinor, type Currency } from "@/domain/money";
import { normalizeText } from "../normalize";
import type { BankParser, ParseResult } from "../types";

/**
 * Entrada manual desde el Atajo: "<monto> <categoría>", efectivo por defecto.
 *   "12.50 comida"   → gasto S/ 12.50, categoría "comida"
 *   "$5 cafe"        → gasto US$ 5.00 en efectivo USD
 *   "+80 venta"      → ingreso S/ 80.00 en efectivo
 */
const PATTERN = /^(\+)?\s*(S\/\.?|US\$|USD|PEN|\$)?\s*(\d+(?:[.,]\d{1,2})?)\s*(.*)$/i;

export const manualParser: BankParser = {
  id: "manual",
  version: 1,

  canParse(input) {
    return input.source === "manual";
  },

  parse(input): ParseResult {
    const text = normalizeText(input.rawText).replace(/\n/g, " ");
    const m = PATTERN.exec(text);
    const amountMinor = m ? parseAmountToMinor(m[3]!) : null;
    if (!m || amountMinor === null || amountMinor <= 0) {
      return { ok: false, reason: "unrecognized", detail: "monto no interpretable" };
    }
    const currency: Currency = m[2] && !/^(S\/|PEN)/i.test(m[2]) ? "USD" : "PEN";
    const isIncome = m[1] === "+";

    return {
      ok: true,
      confidence: 0.95,
      movement: {
        kind: isIncome ? "income_other" : "purchase",
        amountMinor,
        currency,
        occurredAt: input.receivedAt,
        merchant: null,
        account: { bank: null, last4: null, type: "cash", currency },
        counterparty: null,
        categoryHint: m[4]?.trim() || null,
        reference: null,
        keywords: [],
        warnings: [],
      },
    };
  },
};
