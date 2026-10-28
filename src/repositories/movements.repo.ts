import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { accounts, categories, categorizationRules, transactions, transfers } from "@/db/schema";
import { EXPENSE_KINDS, INCOME_KINDS } from "@/domain/ledger";

export interface MovementFilters {
  from: Date;
  to: Date;
  accountId?: string;
  type?: "gastos" | "ingresos";
  q?: string;
}

/** Movimientos del periodo (los anulados no se muestran). Las patas de transferencias propias se marcan para no sumarlas. */
export async function listMovements(ex: Executor, userId: string, f: MovementFilters, limit = 300) {
  const term = f.q?.trim();
  return ex
    .select({
      id: transactions.id,
      kind: transactions.kind,
      status: transactions.status,
      source: transactions.source,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      occurredAt: transactions.occurredAt,
      merchant: transactions.merchant,
      description: transactions.description,
      note: transactions.note,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      accountName: accounts.name,
      accountColor: accounts.color,
      isTransferLeg: sql<boolean>`exists (select 1 from ${transfers} where ${transfers.fromTransactionId} = ${transactions.id} or ${transfers.toTransactionId} = ${transactions.id})`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        inArray(transactions.status, ["posted", "pending_review"]),
        gte(transactions.occurredAt, f.from),
        lt(transactions.occurredAt, f.to),
        f.accountId ? eq(transactions.accountId, f.accountId) : undefined,
        f.type === "gastos" ? inArray(transactions.kind, [...EXPENSE_KINDS]) : undefined,
        f.type === "ingresos" ? inArray(transactions.kind, [...INCOME_KINDS]) : undefined,
        term
          ? or(ilike(transactions.merchant, `%${term}%`), ilike(transactions.description, `%${term}%`), ilike(transactions.note, `%${term}%`))
          : undefined,
      ),
    )
    .orderBy(desc(transactions.occurredAt))
    .limit(limit);
}

export async function listAccountsForFilter(ex: Executor, userId: string) {
  return ex
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))
    .orderBy(accounts.type, accounts.name);
}

export async function listCategories(ex: Executor, userId: string) {
  return ex
    .select({ id: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.userId, userId), isNull(categories.deletedAt)))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

/**
 * Cambia la categoría y, si el movimiento tiene comercio, aprende una regla para los próximos del mismo comercio.
 * Devuelve false si el movimiento o la categoría no son del usuario.
 */
export async function recategorize(ex: Executor, userId: string, transactionId: string, categoryId: string | null) {
  const [txn] = await ex
    .select({ merchantNormalized: transactions.merchantNormalized })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId), isNull(transactions.deletedAt)));
  if (!txn) return false;

  if (categoryId) {
    const [cat] = await ex
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId), isNull(categories.deletedAt)));
    if (!cat) return false;
  }

  await ex
    .update(transactions)
    .set({ categoryId, updatedAt: new Date() })
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));

  if (categoryId && txn.merchantNormalized) {
    // Prioridad alta: una corrección tuya le gana a las reglas genéricas de la semilla.
    await ex
      .insert(categorizationRules)
      .values({ userId, match: "equals", pattern: txn.merchantNormalized, categoryId, priority: 200, learned: true })
      .onConflictDoUpdate({
        target: [categorizationRules.userId, categorizationRules.match, categorizationRules.pattern],
        targetWhere: sql`${categorizationRules.deletedAt} is null`,
        set: { categoryId, updatedAt: new Date() },
      });
  }
  return true;
}
