type Level = "debug" | "info" | "warn" | "error";

/** Nunca se registran: pueden contener montos, nombres o credenciales. */
const REDACT = new Set(["raw_text", "rawtext", "authorization", "token", "password", "body"]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, REDACT.has(k.toLowerCase()) ? "[redactado]" : redact(v, depth + 1)]),
  );
}

/** Log estructurado en una línea JSON (Vercel lo indexa por campos). */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...(redact(fields) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
