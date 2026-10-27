import { and, eq, isNull, sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { categories, categorizationRules } from "@/db/schema";
import { normalizeMerchant, type CategorizationRule } from "@/domain/categorize";

export async function listRules(ex: Executor, userId: string): Promise<CategorizationRule[]> {
  return ex
    .select({
      id: categorizationRules.id,
      match: categorizationRules.match,
      pattern: categorizationRules.pattern,
      categoryId: categorizationRules.categoryId,
      priority: categorizationRules.priority,
    })
    .from(categorizationRules)
    .where(and(eq(categorizationRules.userId, userId), isNull(categorizationRules.deletedAt)));
}

export async function recordRuleHit(ex: Executor, userId: string, ruleId: string) {
  await ex
    .update(categorizationRules)
    .set({ hits: sql`${categorizationRules.hits} + 1` })
    .where(and(eq(categorizationRules.id, ruleId), eq(categorizationRules.userId, userId)));
}

/**
 * Busca por nombre sin distinguir mayúsculas ni tildes ("cafe" → "Café").
 * Se compara en memoria: son decenas de categorías y evita depender de la extensión `unaccent`.
 */
export async function findCategoryByName(ex: Executor, userId: string, name: string, kind: "expense" | "income") {
  const wanted = normalizeMerchant(name);
  if (!wanted) return null;
  const rows = await ex
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.kind, kind), isNull(categories.deletedAt)));
  return (
    rows.find((c) => normalizeMerchant(c.name) === wanted) ??
    rows.find((c) => normalizeMerchant(c.name).startsWith(wanted)) ??
    null
  );
}
