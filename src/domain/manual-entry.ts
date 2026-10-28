import type { TxnKind } from "./ledger";

export type ManualType = "gasto" | "ingreso" | "transferencia";
type AccountType = "checking" | "savings" | "cash" | "wallet" | "debit_card" | "credit_card";

/**
 * Tipo de movimiento para un registro hecho a mano desde Revisión.
 * Entre cuentas propias sigue las mismas reglas que la ingesta: a una tarjeta es pago de tarjeta,
 * de un banco a efectivo es retiro, y lo demás es transferencia (con su pata espejo).
 */
export function manualKinds(
  type: ManualType,
  from: AccountType,
  to: AccountType | null,
): { kind: TxnKind; mirrorKind: TxnKind | null } {
  if (type === "gasto") return { kind: "purchase", mirrorKind: null };
  if (type === "ingreso") return { kind: "income_other", mirrorKind: null };
  if (!to) throw new Error("Una transferencia necesita cuenta destino");
  if (to === "credit_card") return { kind: "card_payment", mirrorKind: "card_payment" };
  if (to === "cash" && from !== "cash") return { kind: "cash_withdrawal", mirrorKind: "cash_withdrawal" };
  return { kind: "transfer_out", mirrorKind: "transfer_in" };
}
