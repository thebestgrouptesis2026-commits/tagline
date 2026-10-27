export const CURRENCIES = ["PEN", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Monto en unidad mínima (céntimos). Nunca float. */
export interface Money {
  amountMinor: number;
  currency: Currency;
}

export type ByCurrency = Partial<Record<Currency, number>>;

const SYMBOL: Record<Currency, string> = { PEN: "S/", USD: "US$" };

export function money(amountMinor: number, currency: Currency): Money {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError(`Monto no entero: ${amountMinor}`);
  return { amountMinor, currency };
}

export function sumByCurrency(items: readonly Money[]): ByCurrency {
  const out: ByCurrency = {};
  for (const m of items) out[m.currency] = (out[m.currency] ?? 0) + m.amountMinor;
  return out;
}

export function addByCurrency(...parts: readonly ByCurrency[]): ByCurrency {
  const out: ByCurrency = {};
  for (const part of parts) {
    for (const c of CURRENCIES) {
      const v = part[c];
      if (v !== undefined) out[c] = (out[c] ?? 0) + v;
    }
  }
  return out;
}

export function negate(by: ByCurrency): ByCurrency {
  const out: ByCurrency = {};
  for (const c of CURRENCIES) {
    const v = by[c];
    if (v !== undefined) out[c] = -v;
  }
  return out;
}

/** "S/ 1,320.00", "-US$ 12.99". Formato fijo es-PE, independiente del runtime. */
export function formatMoney(m: Money, opts: { sign?: boolean } = {}): string {
  const abs = Math.abs(m.amountMinor);
  const units = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (abs % 100).toString().padStart(2, "0");
  const sign = m.amountMinor < 0 ? "-" : opts.sign && m.amountMinor > 0 ? "+" : "";
  return `${sign}${SYMBOL[m.currency]} ${units}.${cents}`;
}

/**
 * Texto → céntimos. Acepta "1,320.00", "1320", "45.9" y coma decimal "12,50".
 * Devuelve null si el formato es ambiguo o inválido (más de 2 decimales, letras, etc.).
 */
export function parseAmountToMinor(input: string): number | null {
  let s = input.trim().replace(/\s/g, "");
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const minor = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * Convierte con un tipo de cambio decimal en texto ("3.7520") usando aritmética entera.
 * Redondeo half-up (alejándose de cero).
 */
export function convertMinor(amountMinor: number, rate: string): number {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(rate.trim());
  if (!m) throw new RangeError(`Tipo de cambio inválido: ${rate}`);
  const scaled = BigInt(m[1]! + (m[2] ?? "").padEnd(6, "0")); // rate × 1e6
  const product = BigInt(amountMinor) * scaled;
  const half = 500_000n;
  const q = product >= 0n ? (product + half) / 1_000_000n : -((-product + half) / 1_000_000n);
  return Number(q);
}

/** Tipos de cambio hacia la moneda base: { USD: "3.7520" }. La base misma no necesita entrada. */
export type FxToBase = Partial<Record<Currency, string>>;

/** Consolida montos por moneda en `base`. Devuelve null si falta algún tipo de cambio. */
export function consolidate(by: ByCurrency, base: Currency, fx: FxToBase): number | null {
  let total = 0;
  for (const c of CURRENCIES) {
    const v = by[c];
    if (v === undefined || v === 0) continue;
    if (c === base) {
      total += v;
      continue;
    }
    const rate = fx[c];
    if (rate === undefined) return null;
    total += convertMinor(v, rate);
  }
  return total;
}
