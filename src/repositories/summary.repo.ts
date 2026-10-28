import { and, count, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
import {
  accounts,
  categories,
  creditCards,
  exchangeRates,
  holidays,
  incomeSources,
  ingestEvents,
  installmentPlans,
  installments,
  recurringExpenses,
  transactions,
  transfers,
} from "@/db/schema";
import { EXPENSE_KINDS, INCOME_KINDS } from "@/domain/ledger";

const postedLive = (userId: string) =>
  and(eq(transactions.userId, userId), eq(transactions.status, "posted"), isNull(transactions.deletedAt));

/** Excluye las patas de transferencias entre cuentas propias (evita doble conteo). */
const notTransferLeg = sql`not exists (select 1 from ${transfers} where ${transfers.fromTransactionId} = ${transactions.id} or ${transfers.toTransactionId} = ${transactions.id})`;

const notInstallmentPurchase = sql`not exists (select 1 from ${installmentPlans} where ${installmentPlans.transactionId} = ${transactions.id} and ${installmentPlans.deletedAt} is null)`;

export async function accountBalances(ex: Executor, userId: string) {
  return ex
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currency: accounts.currency,
      color: accounts.color,
      creditCardId: accounts.creditCardId,
      includeInNetWorth: accounts.includeInNetWorth,
      openingBalanceMinor: accounts.openingBalanceMinor,
      openingBalanceAt: accounts.openingBalanceAt,
      balanceMinor: sql<number>`${accounts.openingBalanceMinor} + coalesce(sum(${transactions.amountMinor}), 0)`.mapWith(Number),
    })
    .from(accounts)
    .leftJoin(
      transactions,
      and(
        eq(transactions.accountId, accounts.id),
        eq(transactions.status, "posted"),
        isNull(transactions.deletedAt),
        gte(transactions.occurredAt, accounts.openingBalanceAt),
      ),
    )
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))
    .groupBy(accounts.id)
    .orderBy(accounts.type, accounts.name);
}

export async function monthTotals(ex: Executor, userId: string, from: Date, to: Date) {
  return ex
    .select({
      currency: transactions.currency,
      incomeMinor: sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${inArray(transactions.kind, [...INCOME_KINDS])} and ${transactions.amountMinor} > 0), 0)`.mapWith(Number),
      expenseMinor: sql<number>`coalesce(-sum(${transactions.amountMinor}) filter (where ${inArray(transactions.kind, [...EXPENSE_KINDS])}), 0)`.mapWith(Number),
    })
    .from(transactions)
    .where(and(postedLive(userId), gte(transactions.occurredAt, from), lt(transactions.occurredAt, to), notTransferLeg))
    .groupBy(transactions.currency);
}

export async function expensesByCategory(ex: Executor, userId: string, from: Date, to: Date, limit = 5) {
  return ex
    .select({
      categoryId: transactions.categoryId,
      name: sql<string>`coalesce(${categories.name}, 'Sin categoría')`,
      color: categories.color,
      currency: transactions.currency,
      totalMinor: sql<number>`-sum(${transactions.amountMinor})`.mapWith(Number),
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        postedLive(userId),
        inArray(transactions.kind, [...EXPENSE_KINDS]),
        gte(transactions.occurredAt, from),
        lt(transactions.occurredAt, to),
        notTransferLeg,
      ),
    )
    .groupBy(transactions.categoryId, categories.name, categories.color, transactions.currency)
    .orderBy(desc(sql`-sum(${transactions.amountMinor})`))
    .limit(limit);
}

export async function listCreditCards(ex: Executor, userId: string) {
  return ex
    .select()
    .from(creditCards)
    .where(and(eq(creditCards.userId, userId), isNull(creditCards.deletedAt)));
}

/**
 * Por cuenta de tarjeta: consumo neto de dos ciclos (cerrado y abierto) y pagos desde el último corte.
 * Las compras en cuotas se excluyen: entran por `installmentsDue`.
 */
export async function cardCycleSums(
  ex: Executor,
  userId: string,
  accountId: string,
  bounds: { lastStart: Date; lastEnd: Date; openEnd: Date },
) {
  const inRange = (from: Date, to: Date) =>
    sql`${transactions.occurredAt} >= ${from.toISOString()} and ${transactions.occurredAt} < ${to.toISOString()}`;
  const [row] = await ex
    .select({
      lastNet: sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.kind} <> 'card_payment' and ${inRange(bounds.lastStart, bounds.lastEnd)} and ${notInstallmentPurchase}), 0)`.mapWith(Number),
      openNet: sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.kind} <> 'card_payment' and ${inRange(bounds.lastEnd, bounds.openEnd)} and ${notInstallmentPurchase}), 0)`.mapWith(Number),
      paymentsSinceClosing: sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.kind} = 'card_payment' and ${transactions.occurredAt} >= ${bounds.lastEnd.toISOString()}), 0)`.mapWith(Number),
    })
    .from(transactions)
    .where(and(postedLive(userId), eq(transactions.accountId, accountId)));
  return row ?? { lastNet: 0, openNet: 0, paymentsSinceClosing: 0 };
}

export async function installmentsDue(ex: Executor, userId: string, creditCardId: string, currency: "PEN" | "USD", cycleClosing: string) {
  const [row] = await ex
    .select({
      totalMinor: sql<number>`coalesce(sum(coalesce(${installments.amountMinorActual}, ${installments.amountMinorEstimated})), 0)`.mapWith(Number),
    })
    .from(installments)
    .innerJoin(installmentPlans, eq(installmentPlans.id, installments.planId))
    .where(
      and(
        eq(installmentPlans.userId, userId),
        eq(installmentPlans.creditCardId, creditCardId),
        eq(installmentPlans.currency, currency),
        eq(installmentPlans.status, "active"),
        isNull(installmentPlans.deletedAt),
        eq(installments.cycleClosing, cycleClosing),
      ),
    );
  return row?.totalMinor ?? 0;
}

export async function activeMonthlyRecurring(ex: Executor, userId: string) {
  return ex
    .select({
      id: recurringExpenses.id,
      name: recurringExpenses.name,
      amountMinor: recurringExpenses.amountMinor,
      currency: recurringExpenses.currency,
      dueDay: recurringExpenses.dueDay,
      lastChargedAt: recurringExpenses.lastChargedAt,
      paymentAccountType: accounts.type,
    })
    .from(recurringExpenses)
    .leftJoin(accounts, eq(accounts.id, recurringExpenses.paymentAccountId))
    .where(
      and(
        eq(recurringExpenses.userId, userId),
        eq(recurringExpenses.active, true),
        eq(recurringExpenses.suggested, false),
        eq(recurringExpenses.frequency, "monthly"),
        isNull(recurringExpenses.deletedAt),
      ),
    );
}

export async function salarySchedule(ex: Executor, userId: string) {
  const [row] = await ex
    .select({ expectedDay: incomeSources.expectedDay, payAdjust: incomeSources.payAdjust })
    .from(incomeSources)
    .where(
      and(
        eq(incomeSources.userId, userId),
        eq(incomeSources.isSalary, true),
        eq(incomeSources.active, true),
        eq(incomeSources.frequency, "monthly"),
        isNull(incomeSources.deletedAt),
      ),
    )
    .limit(1);
  return row?.expectedDay ? { expectedDay: row.expectedDay, payAdjust: row.payAdjust } : null;
}

export async function latestUsdRate(ex: Executor, onOrBefore: string) {
  const [row] = await ex
    .select({ rate: exchangeRates.rate, day: exchangeRates.day })
    .from(exchangeRates)
    .where(and(eq(exchangeRates.base, "USD"), eq(exchangeRates.quote, "PEN"), lte(exchangeRates.day, onOrBefore)))
    .orderBy(desc(exchangeRates.day))
    .limit(1);
  return row ?? null;
}

export async function holidaysBetween(ex: Executor, from: string, to: string): Promise<Set<string>> {
  const rows = await ex
    .select({ day: holidays.day })
    .from(holidays)
    .where(and(gte(holidays.day, from), lte(holidays.day, to)));
  return new Set(rows.map((r) => r.day));
}

export async function recentTransactions(ex: Executor, userId: string, limit = 8) {
  return ex
    .select({
      id: transactions.id,
      kind: transactions.kind,
      status: transactions.status,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      occurredAt: transactions.occurredAt,
      merchant: transactions.merchant,
      accountName: accounts.name,
      accountColor: accounts.color,
      categoryName: categories.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))
    .orderBy(desc(transactions.occurredAt))
    .limit(limit);
}

export async function reviewCount(ex: Executor, userId: string) {
  const [row] = await ex
    .select({ n: count() })
    .from(ingestEvents)
    .where(and(eq(ingestEvents.userId, userId), eq(ingestEvents.status, "needs_review")));
  return row?.n ?? 0;
}
