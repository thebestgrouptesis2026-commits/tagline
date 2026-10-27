import { and, desc, eq, isNull } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { incomeSources, transactions, transfers, users } from "@/db/schema";

type NewTransaction = Omit<typeof transactions.$inferInsert, "userId" | "id">;

export async function insertTransaction(ex: Executor, userId: string, values: NewTransaction) {
  const [row] = await ex
    .insert(transactions)
    .values({ ...values, userId })
    .returning({ id: transactions.id });
  return row!;
}

export async function linkTransfer(ex: Executor, userId: string, fromTransactionId: string, toTransactionId: string) {
  await ex.insert(transfers).values({ userId, fromTransactionId, toTransactionId });
}

export async function listActiveSalarySources(ex: Executor, userId: string) {
  return ex
    .select()
    .from(incomeSources)
    .where(
      and(
        eq(incomeSources.userId, userId),
        eq(incomeSources.isSalary, true),
        eq(incomeSources.active, true),
        isNull(incomeSources.deletedAt),
      ),
    );
}

export async function lastSalaryAt(ex: Executor, userId: string): Promise<Date | null> {
  const [row] = await ex
    .select({ at: transactions.occurredAt })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.kind, "salary"),
        eq(transactions.status, "posted"),
        isNull(transactions.deletedAt),
      ),
    )
    .orderBy(desc(transactions.occurredAt))
    .limit(1);
  return row?.at ?? null;
}

export async function getUserSettings(ex: Executor, userId: string) {
  const [row] = await ex
    .select({ name: users.name, reviewThreshold: users.reviewThreshold, baseCurrency: users.baseCurrency, timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}
