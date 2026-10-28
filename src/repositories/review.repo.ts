import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { accounts, categories, ingestEvents, transactions } from "@/db/schema";

/** Eventos que esperan una decisión tuya, con los movimientos que alcanzaron a crearse (si alguno). */
export async function listReviewItems(ex: Executor, userId: string, limit = 50) {
  const events = await ex
    .select({
      id: ingestEvents.id,
      source: ingestEvents.source,
      sender: ingestEvents.sender,
      rawText: ingestEvents.rawText,
      receivedAt: ingestEvents.receivedAt,
      parsed: ingestEvents.parsed,
      error: ingestEvents.error,
      replyText: ingestEvents.replyText,
    })
    .from(ingestEvents)
    .where(and(eq(ingestEvents.userId, userId), eq(ingestEvents.status, "needs_review")))
    .orderBy(desc(ingestEvents.receivedAt))
    .limit(limit);
  if (events.length === 0) return [];

  const txns = await ex
    .select({
      id: transactions.id,
      ingestEventId: transactions.ingestEventId,
      kind: transactions.kind,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      occurredAt: transactions.occurredAt,
      merchant: transactions.merchant,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      accountName: accounts.name,
      accountType: accounts.type,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        eq(transactions.status, "pending_review"),
        inArray(
          transactions.ingestEventId,
          events.map((e) => e.id),
        ),
      ),
    )
    .orderBy(transactions.amountMinor);

  return events.map((e) => ({ ...e, transactions: txns.filter((t) => t.ingestEventId === e.id) }));
}

export type ReviewItem = Awaited<ReturnType<typeof listReviewItems>>[number];

export async function findReviewEvent(ex: Executor, userId: string, eventId: string) {
  const [row] = await ex
    .select({ id: ingestEvents.id, source: ingestEvents.source, receivedAt: ingestEvents.receivedAt })
    .from(ingestEvents)
    .where(and(eq(ingestEvents.id, eventId), eq(ingestEvents.userId, userId), eq(ingestEvents.status, "needs_review")));
  return row ?? null;
}

export async function setEventTransactionsStatus(ex: Executor, userId: string, eventId: string, status: "posted" | "voided") {
  await ex
    .update(transactions)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.ingestEventId, eventId),
        eq(transactions.status, "pending_review"),
        isNull(transactions.deletedAt),
      ),
    );
}

export async function listOwnAccounts(ex: Executor, userId: string) {
  return ex
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currency: accounts.currency,
      bank: accounts.bank,
      last4: accounts.last4,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))
    .orderBy(accounts.type, accounts.name);
}
