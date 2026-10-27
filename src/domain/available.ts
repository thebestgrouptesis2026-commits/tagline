import { diffDays, type CalendarDate } from "./dates";
import {
  addByCurrency,
  consolidate,
  negate,
  sumByCurrency,
  type ByCurrency,
  type Currency,
  type FxToBase,
  type Money,
} from "./money";

export interface FixedExpenseDue {
  name: string;
  amount: Money;
  dueDate: CalendarDate;
  paid: boolean;
  /** Se carga a una tarjeta: no sale del saldo ahora, entra en el pago de la tarjeta. */
  paidWithCreditCard: boolean;
}

export interface CardPaymentDue {
  name: string;
  /** Saldo pendiente del estado de cuenta (positivo). */
  amount: Money;
  dueDate: CalendarDate;
}

export interface AvailableInput {
  today: CalendarDate;
  nextPayday: CalendarDate;
  /** Saldos de cuentas de libre disponibilidad (sueldo, efectivo, billeteras). */
  liquidBalances: readonly Money[];
  fixedExpenses: readonly FixedExpenseDue[];
  cardPayments: readonly CardPaymentDue[];
  baseCurrency: Currency;
  fxToBase: FxToBase;
}

export interface Commitment {
  kind: "fixed" | "card";
  name: string;
  amount: Money;
  dueDate: CalendarDate;
}

export interface AvailableResult {
  byCurrency: ByCurrency;
  /** null si hay montos en otra moneda y falta el tipo de cambio. */
  consolidated: { currency: Currency; amountMinor: number } | null;
  breakdown: { balance: ByCurrency; pendingFixed: ByCurrency; cardPayments: ByCurrency };
  commitments: Commitment[];
  daysUntilPayday: number;
  /** Disponible ÷ días restantes (incluye hoy), en moneda base. null si no hay consolidado. */
  perDayMinor: number | null;
}

/**
 * Disponible hasta el próximo sueldo =
 *   saldo líquido − gastos fijos pendientes (no cargados a tarjeta) − pagos de tarjeta que vencen antes del sueldo.
 * Los compromisos vencidos e impagos también se restan: siguen siendo deuda.
 */
export function availableUntilPayday(input: AvailableInput): AvailableResult {
  const commitments: Commitment[] = [];

  for (const f of input.fixedExpenses) {
    if (f.paid || f.paidWithCreditCard || f.amount.amountMinor <= 0) continue;
    if (f.dueDate >= input.nextPayday) continue;
    commitments.push({ kind: "fixed", name: f.name, amount: f.amount, dueDate: f.dueDate });
  }
  for (const c of input.cardPayments) {
    if (c.amount.amountMinor <= 0 || c.dueDate >= input.nextPayday) continue;
    commitments.push({ kind: "card", name: c.name, amount: c.amount, dueDate: c.dueDate });
  }
  commitments.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));

  const balance = sumByCurrency(input.liquidBalances);
  const pendingFixed = sumByCurrency(commitments.filter((c) => c.kind === "fixed").map((c) => c.amount));
  const cardPayments = sumByCurrency(commitments.filter((c) => c.kind === "card").map((c) => c.amount));
  const byCurrency = addByCurrency(balance, negate(pendingFixed), negate(cardPayments));
  byCurrency[input.baseCurrency] ??= 0;

  const total = consolidate(byCurrency, input.baseCurrency, input.fxToBase);
  const daysUntilPayday = Math.max(diffDays(input.today, input.nextPayday), 0);
  const perDayMinor = total === null ? null : Math.floor(total / Math.max(daysUntilPayday, 1));

  return {
    byCurrency,
    consolidated: total === null ? null : { currency: input.baseCurrency, amountMinor: total },
    breakdown: { balance, pendingFixed, cardPayments },
    commitments,
    daysUntilPayday,
    perDayMinor,
  };
}
