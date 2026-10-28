import {
  addDays,
  adjustToBusinessDay,
  daysInMonth,
  makeDate,
  parts,
  toLimaDate,
  type BusinessDayAdjust,
  type CalendarDate,
} from "./dates";

export interface CardCycleConfig {
  /** Día de corte (1–31). Si el mes es más corto, se usa el último día. */
  closingDay: number;
  /** Día de pago (1–31). Si es <= día de corte, cae en el mes siguiente al corte. */
  dueDay: number;
  closingAdjust: BusinessDayAdjust;
  dueAdjust: BusinessDayAdjust;
}

export interface BillingCycle {
  /** Primer día incluido en el ciclo (día siguiente al corte anterior). */
  periodStart: CalendarDate;
  /** Último día incluido (el día del corte entra en este ciclo). */
  closingDate: CalendarDate;
  dueDate: CalendarDate;
}

type Holidays = ReadonlySet<CalendarDate>;

function closingFor(year: number, month: number, card: CardCycleConfig, holidays: Holidays) {
  return adjustToBusinessDay(makeDate(year, month, card.closingDay), card.closingAdjust, holidays);
}

function dueFor(year: number, month: number, card: CardCycleConfig, holidays: Holidays) {
  // `makeDate` normaliza el mes, así que (year, month) puede venir fuera de rango.
  const { year: y, month: m } = parts(makeDate(year, month, 1));
  const nominalClosingDay = Math.min(card.closingDay, daysInMonth(y, m));
  const due =
    card.dueDay > nominalClosingDay ? makeDate(y, m, card.dueDay) : makeDate(y, m + 1, card.dueDay);
  return adjustToBusinessDay(due, card.dueAdjust, holidays);
}

/** Ciclo cuyo corte nominal cae en (year, month). */
export function cycleForClosingMonth(
  year: number,
  month: number,
  card: CardCycleConfig,
  holidays: Holidays,
): BillingCycle {
  return {
    periodStart: addDays(closingFor(year, month - 1, card, holidays), 1),
    closingDate: closingFor(year, month, card, holidays),
    dueDate: dueFor(year, month, card, holidays),
  };
}

/** Ciclo (estado de cuenta) al que pertenece un consumo hecho en la fecha `date` (hora de Lima). */
export function cycleForDate(date: CalendarDate, card: CardCycleConfig, holidays: Holidays): BillingCycle {
  const { year, month } = parts(date);
  const current = cycleForClosingMonth(year, month, card, holidays);
  if (date < current.periodStart) return cycleForClosingMonth(year, month - 1, card, holidays);
  if (date <= current.closingDate) return current;
  return cycleForClosingMonth(year, month + 1, card, holidays);
}

/** Igual que `cycleForDate`, pero desde un instante UTC (convierte a fecha de Lima). */
export function cycleForInstant(instant: Date, card: CardCycleConfig, holidays: Holidays): BillingCycle {
  return cycleForDate(toLimaDate(instant), card, holidays);
}

/** Último ciclo ya cerrado a la fecha `today`: es el estado de cuenta que toca pagar. */
export function lastClosedCycle(today: CalendarDate, card: CardCycleConfig, holidays: Holidays): BillingCycle {
  const open = cycleForDate(today, card, holidays);
  return cycleForDate(addDays(open.periodStart, -1), card, holidays);
}

/**
 * Primer vencimiento en o después de `date`. Sirve para la deuda de apertura de una tarjeta:
 * lo que ya debías al registrarla se paga en el próximo vencimiento, sea del estado ya cerrado o del ciclo abierto.
 */
export function firstDueOnOrAfter(date: CalendarDate, card: CardCycleConfig, holidays: Holidays): CalendarDate {
  const closed = lastClosedCycle(date, card, holidays);
  return closed.dueDate >= date ? closed.dueDate : cycleForDate(date, card, holidays).dueDate;
}
