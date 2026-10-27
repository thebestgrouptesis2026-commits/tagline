export const TXN_KINDS = [
  "purchase",
  "deposit",
  "salary",
  "income_other",
  "transfer_out",
  "transfer_in",
  "cash_withdrawal",
  "card_payment",
  "refund",
  "fee",
  "interest",
  "adjustment",
] as const;
export type TxnKind = (typeof TXN_KINDS)[number];

/** Tipos que sacan dinero de la cuenta (o aumentan la deuda de una tarjeta): se guardan con signo negativo. */
const OUTFLOW_KINDS: ReadonlySet<TxnKind> = new Set([
  "purchase",
  "transfer_out",
  "cash_withdrawal",
  "card_payment",
  "fee",
  "interest",
]);

export function signedAmount(kind: TxnKind, magnitudeMinor: number): number {
  const abs = Math.abs(magnitudeMinor);
  return OUTFLOW_KINDS.has(kind) ? -abs : abs;
}

/**
 * Qué cuenta como ingreso o gasto en reportes. Las patas de una transferencia entre
 * cuentas propias (tabla `transfers`) se excluyen siempre, además de estos tipos internos.
 */
export const INCOME_KINDS = ["salary", "deposit", "income_other", "transfer_in"] as const satisfies readonly TxnKind[];
/** `refund` es positivo y resta del gasto. */
export const EXPENSE_KINDS = ["purchase", "transfer_out", "fee", "interest", "refund"] as const satisfies readonly TxnKind[];
export const INTERNAL_KINDS = ["cash_withdrawal", "card_payment", "adjustment"] as const satisfies readonly TxnKind[];
