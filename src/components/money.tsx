import { CURRENCIES, formatMoney, type ByCurrency, type Currency } from "@/domain/money";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];

/** "2026-11-27" → "27 nov". */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

export function monthLabel(date: string): string {
  const [y, m] = date.split("-");
  return `${MONTHS_LONG[Number(m) - 1]} ${y}`;
}

export function Amount({
  minor,
  currency,
  tone = "plain",
  sign = false,
  className = "",
}: {
  minor: number;
  currency: Currency;
  /** "auto": verde si entra, rojo si sale. */
  tone?: "plain" | "auto" | "income" | "expense";
  sign?: boolean;
  className?: string;
}) {
  const color =
    tone === "income" || (tone === "auto" && minor > 0)
      ? "text-income"
      : tone === "expense" || (tone === "auto" && minor < 0)
        ? "text-expense"
        : "";
  return <span className={`num ${color} ${className}`}>{formatMoney({ amountMinor: minor, currency }, { sign })}</span>;
}

/** Muestra cada moneda presente; la base primero. Vacío → S/ 0.00. */
export function AmountByCurrency({ value, ...rest }: { value: ByCurrency } & Omit<Parameters<typeof Amount>[0], "minor" | "currency">) {
  const present = CURRENCIES.filter((c) => (value[c] ?? 0) !== 0);
  if (present.length === 0) return <Amount minor={0} currency="PEN" {...rest} />;
  return (
    <>
      {present.map((c, i) => (
        <span key={c}>
          {i > 0 ? <span className="text-muted"> · </span> : null}
          <Amount minor={value[c]!} currency={c} {...rest} />
        </span>
      ))}
    </>
  );
}
