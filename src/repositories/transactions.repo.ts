import { and, between, desc, eq, inArray, isNull } from "drizzle-orm";
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

/** Margen para emparejar los dos correos de un mismo movimiento entre cuentas propias (cada banco avisa por su lado). */
export const PAIR_WINDOW_MS = 30 * 60_000;

/**
 * Pata de entrada ya creada por una transferencia propia (la registró el correo del banco de origen):
 * misma cuenta, mismo monto y hora cercana.
 */
export async function findTransferInLeg(ex: Executor, userId: string, accountId: string, amountMinor: number, around: Date) {
  const [row] = await ex
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(transfers, eq(transfers.toTransactionId, transactions.id))
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, accountId),
        eq(transactions.amountMinor, Math.abs(amountMinor)),
        inArray(transactions.status, ["posted", "pending_review"]),
        isNull(transactions.deletedAt),
        between(transactions.occurredAt, new Date(around.getTime() - PAIR_WINDOW_MS), new Date(around.getTime() + PAIR_WINDOW_MS)),
      ),
    )
    .limit(1);
  return row ?? null;
}
