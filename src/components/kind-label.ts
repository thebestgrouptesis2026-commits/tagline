const LABELS: Record<string, string> = {
  salary: "Sueldo",
  deposit: "Depósito",
  income_other: "Ingreso",
  transfer_in: "Transferencia recibida",
  transfer_out: "Transferencia enviada",
  cash_withdrawal: "Retiro de efectivo",
  card_payment: "Pago de tarjeta",
  refund: "Devolución",
  fee: "Comisión",
  interest: "Interés",
  purchase: "Compra",
};

export function labelForKind(kind: string): string {
  return LABELS[kind] ?? "Movimiento";
}
