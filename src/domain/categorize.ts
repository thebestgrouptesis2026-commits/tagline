export type RuleMatch = "contains" | "equals" | "starts_with" | "regex";

export interface CategorizationRule {
  id: string;
  match: RuleMatch;
  /** Ya normalizado con `normalizeMerchant` (salvo regex). */
  pattern: string;
  categoryId: string;
  priority: number;
}

/** "Plaza Vea  San Isidro*" → "PLAZA VEA SAN ISIDRO". */
export function normalizeMerchant(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function matches(rule: CategorizationRule, merchant: string): boolean {
  switch (rule.match) {
    case "equals":
      return merchant === rule.pattern;
    case "starts_with":
      return merchant.startsWith(rule.pattern);
    case "contains":
      return merchant.includes(rule.pattern);
    case "regex":
      try {
        return new RegExp(rule.pattern, "i").test(merchant);
      } catch {
        return false; // Una regex inválida guardada por error no debe tumbar la ingesta.
      }
  }
}

/** Gana la regla de mayor prioridad; a igual prioridad, el patrón más largo (más específico). */
export function categorize(
  merchantNormalized: string | null,
  rules: readonly CategorizationRule[],
): { categoryId: string; ruleId: string } | null {
  if (!merchantNormalized) return null;
  const ordered = [...rules].sort((a, b) => b.priority - a.priority || b.pattern.length - a.pattern.length);
  const hit = ordered.find((r) => matches(r, merchantNormalized));
  return hit ? { categoryId: hit.categoryId, ruleId: hit.id } : null;
}
