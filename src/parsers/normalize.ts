import { LIMA_OFFSET_MINUTES } from "@/domain/dates";
import { parseAmountToMinor, type Currency, type Money } from "@/domain/money";

/** Unifica saltos de línea y espacios raros de los correos (nbsp, tabs, espacios finos). */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[   ]/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "Fecha y Hora" → "fecha y hora"; "Operación" → "operacion". */
export function foldKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Lee líneas "Clave: valor" (tablas de constancias). Gana la primera aparición de cada clave. */
export function parseKeyValues(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^([^:\n]{2,40}):\s*(.+)$/.exec(line);
    if (!m) continue;
    const key = foldKey(m[1]!);
    if (!out.has(key)) out.set(key, m[2]!.trim());
  }
  return out;
}

/** "S/ 1,320.00" | "US$ 12.99" | "USD 5.00" → Money. Sin símbolo reconocible → null. */
export function parseMoney(s: string): Money | null {
  const m = /(S\/\.?|US\$|USD|PEN|\$)\s*(\d[\d.,]*)/i.exec(s);
  if (!m) return null;
  const currency: Currency = /^(S\/|PEN)/i.test(m[1]!) ? "PEN" : "USD";
  const amountMinor = parseAmountToMinor(m[2]!.replace(/[.,]$/, ""));
  if (amountMinor === null || amountMinor <= 0) return null;
  return { amountMinor, currency };
}

/** "27/10/2026 - 14:03 h." | "27/10/2026 02:03 p.m." | "27/10/2026" (hora de Lima) → instante UTC. */
export function parseLimaDateTime(s: string): Date | null {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D{1,5}(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s?m\.?)?)?/i.exec(s);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let hour = m[4] ? Number(m[4]) : 12; // sin hora: mediodía, para no cambiar de día al pasar a UTC
  const minute = m[5] ? Number(m[5]) : 0;
  const meridiem = m[6]?.toLowerCase();
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute) - LIMA_OFFSET_MINUTES * 60_000;
  const d = new Date(utc);
  // Rechaza 31/02 y similares (Date.UTC los desborda al mes siguiente).
  return new Date(utc + LIMA_OFFSET_MINUTES * 60_000).getUTCDate() === day ? d : null;
}

/** "Cuentas de Ahorros Soles - *1234" → "1234". */
export function lastFour(s: string): string | null {
  return /\*+\s?(\d{4})\b/.exec(s)?.[1] ?? null;
}

/** Moneda a partir de la descripción de la cuenta ("Ahorro Soles", "Cuenta Dólares"). */
export function currencyFromLabel(s: string): Currency | null {
  const f = foldKey(s);
  if (/\bdolares\b|us\$/.test(f)) return "USD";
  if (/\bsoles\b|s\//.test(f)) return "PEN";
  return null;
}

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6,
  jul: 7, julio: 7, ago: 8, agosto: 8, set: 9, sep: 9, sept: 9, septiembre: 9, setiembre: 9,
  oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12,
};

/**
 * "26 de octubre de 2026 - 01:02 PM" | "12 Nov 2025 11:28 AM" | "08 Ago 2025 12:47 PM" (hora de Lima) → instante UTC.
 * Sin hora → mediodía. AM/PM opcional (sin él, formato 24 h).
 */
export function parseLimaTextDate(s: string): Date | null {
  const m = /(\d{1,2})\s+(?:de\s+)?([A-Za-zñÑ]{3,10})\.?\s+(?:de\s+)?(\d{4})(?:\D{1,5}(\d{1,2}):(\d{2})\s*([ap])?\.?\s?m?\.?)?/i.exec(foldKey(s));
  if (!m) return null;
  const month = MONTHS[m[2]!];
  if (!month) return null;
  return parseLimaDateTime(
    `${m[1]}/${month}/${m[3]}${m[4] ? ` ${m[4]}:${m[5]}${m[6] ? ` ${m[6]}m` : ""}` : ""}`,
  );
}

/**
 * Para correos con tabla "Etiqueta   Valor" sin dos puntos (valor en la misma línea tras la
 * etiqueta, o en la línea siguiente según cómo se aplane el HTML). Solo reconoce `labels`.
 */
export function parseLabelBlocks(text: string, labels: readonly string[]): Map<string, string> {
  const folded = labels.map((l) => ({ label: l, key: foldKey(l) })).sort((a, b) => b.key.length - a.key.length);
  const lines = text.split("\n");
  const out = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const f = foldKey(lines[i]!);
    const hit = folded.find((l) => f === l.key || f.startsWith(`${l.key} `));
    if (!hit || out.has(hit.key)) continue;
    let value = f === hit.key ? "" : lines[i]!.trim().slice(hit.key.length).trim();
    for (let j = i + 1; !value && j < lines.length; j++) {
      const next = lines[j]!.trim();
      if (next && !folded.some((l) => foldKey(next) === l.key)) value = next;
      else if (next) break;
    }
    if (value) out.set(hit.key, value);
  }
  return out;
}
