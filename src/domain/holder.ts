import { normalizeMerchant } from "./categorize";

/**
 * ¿`seen` (como aparece en un correo: "Juan P Perez M.") es el mismo titular que `full`
 * (el nombre guardado del usuario)? Cada palabra de `seen` debe estar en `full`; una inicial
 * ("Z", "M") vale si coincide con la primera letra de alguna palabra. Exige al menos 2 palabras.
 */
export function isSameHolder(seen: string | null | undefined, full: string | null | undefined): boolean {
  if (!seen || !full) return false;
  const a = normalizeMerchant(seen).split(" ").filter(Boolean);
  const b = normalizeMerchant(full).split(" ").filter(Boolean);
  if (a.length < 2 || b.length < 2) return false;
  return a.every((w) => b.some((x) => (w.length === 1 ? x.startsWith(w) : x === w)));
}
