/**
 * Fechas de calendario en hora de Lima como "YYYY-MM-DD".
 * Las cadenas ISO se comparan lexicográficamente, así que `a < b` funciona.
 */
export type CalendarDate = string;

/** Perú no usa horario de verano: UTC−5 todo el año. */
export const LIMA_OFFSET_MINUTES = -5 * 60;
const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type BusinessDayAdjust = "none" | "previous" | "next";

function toMs(date: CalendarDate): number {
  const m = ISO_DATE.exec(date);
  if (!m) throw new RangeError(`Fecha inválida: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromMs(ms: number): CalendarDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function parts(date: CalendarDate): { year: number; month: number; day: number } {
  const d = new Date(toMs(date));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Construye una fecha normalizando meses fuera de rango (mes 13 → enero siguiente)
 * y recortando el día al fin de mes (31 de febrero → 28/29).
 */
export function makeDate(year: number, month: number, day: number): CalendarDate {
  const norm = new Date(Date.UTC(year, month - 1, 1));
  const y = norm.getUTCFullYear();
  const m = norm.getUTCMonth() + 1;
  const d = Math.min(Math.max(day, 1), daysInMonth(y, m));
  return fromMs(Date.UTC(y, m - 1, d));
}

export function addDays(date: CalendarDate, n: number): CalendarDate {
  return fromMs(toMs(date) + n * DAY_MS);
}

/** Días de `from` a `to` (positivo si `to` es posterior). */
export function diffDays(from: CalendarDate, to: CalendarDate): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

/** 0 = domingo … 6 = sábado. */
export function dayOfWeek(date: CalendarDate): number {
  return new Date(toMs(date)).getUTCDay();
}

export function toLimaDate(instant: Date): CalendarDate {
  return fromMs(instant.getTime() + LIMA_OFFSET_MINUTES * 60_000);
}

/** Instante UTC en que empieza el día `date` en Lima. */
export function limaStartOfDayUtc(date: CalendarDate): Date {
  return new Date(toMs(date) - LIMA_OFFSET_MINUTES * 60_000);
}

/** Primer día del mes de `date`. */
export function startOfMonth(date: CalendarDate): CalendarDate {
  const { year, month } = parts(date);
  return makeDate(year, month, 1);
}

export function isBusinessDay(date: CalendarDate, holidays: ReadonlySet<CalendarDate>): boolean {
  const dow = dayOfWeek(date);
  return dow !== 0 && dow !== 6 && !holidays.has(date);
}

export function adjustToBusinessDay(
  date: CalendarDate,
  mode: BusinessDayAdjust,
  holidays: ReadonlySet<CalendarDate>,
): CalendarDate {
  if (mode === "none") return date;
  const step = mode === "previous" ? -1 : 1;
  let d = date;
  // Como máximo una semana larga de feriados; el límite evita bucles infinitos con datos corruptos.
  for (let i = 0; i < 14 && !isBusinessDay(d, holidays); i++) d = addDays(d, step);
  return d;
}
