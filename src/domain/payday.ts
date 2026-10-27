import { addDays, adjustToBusinessDay, makeDate, parts, type BusinessDayAdjust, type CalendarDate } from "./dates";
import type { Currency } from "./money";

export interface MonthlyPaySchedule {
  frequency: "monthly";
  expectedDay: number;
  payAdjust: BusinessDayAdjust;
}

/** Un sueldo recibido hasta N días antes de la fecha esperada cuenta como el sueldo de ese mes. */
export const SALARY_EARLY_WINDOW_DAYS = 5;

export function paydayForMonth(
  year: number,
  month: number,
  schedule: MonthlyPaySchedule,
  holidays: ReadonlySet<CalendarDate>,
): CalendarDate {
  return adjustToBusinessDay(makeDate(year, month, schedule.expectedDay), schedule.payAdjust, holidays);
}

/**
 * Próxima fecha en que se espera el sueldo, a partir de `today` (incluido).
 * Si el sueldo de ese periodo ya llegó (`lastSalaryDate`), salta al mes siguiente.
 */
export function nextPayday(
  today: CalendarDate,
  schedule: MonthlyPaySchedule,
  holidays: ReadonlySet<CalendarDate>,
  lastSalaryDate?: CalendarDate | null,
): CalendarDate {
  const { year, month } = parts(today);
  for (let i = 0; i < 3; i++) {
    const candidate = paydayForMonth(year, month + i, schedule, holidays);
    if (candidate < today) continue;
    const alreadyPaid =
      lastSalaryDate != null && lastSalaryDate >= addDays(candidate, -SALARY_EARLY_WINDOW_DAYS);
    if (!alreadyPaid) return candidate;
  }
  // Inalcanzable con un calendario válido: siempre hay un candidato en 3 meses.
  throw new Error("No se pudo calcular el próximo sueldo");
}

export interface SalaryMatchSource {
  expectedAmountMinor: number | null;
  currency: Currency;
  amountTolerancePct: number;
  destinationAccountId: string | null;
  keywords: readonly string[];
}

export interface IncomingMovement {
  amountMinor: number;
  currency: Currency;
  accountId: string;
  text: string;
}

/**
 * ¿Este abono es el sueldo? Basta una palabra clave ("PLANILLA") o
 * un monto dentro de la tolerancia en la cuenta de destino configurada.
 */
export function matchesSalary(mv: IncomingMovement, source: SalaryMatchSource): boolean {
  if (mv.currency !== source.currency) return false;
  const text = mv.text.toUpperCase();
  if (source.keywords.some((k) => k.trim() && text.includes(k.trim().toUpperCase()))) return true;
  if (source.expectedAmountMinor == null || source.destinationAccountId !== mv.accountId) return false;
  const tolerance = Math.round((source.expectedAmountMinor * source.amountTolerancePct) / 100);
  return Math.abs(mv.amountMinor - source.expectedAmountMinor) <= tolerance;
}
