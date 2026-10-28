import { getDb } from "@/db/client";
import { availableUntilPayday, type AvailableResult, type CardPaymentDue, type FixedExpenseDue } from "@/domain/available";
import { cycleForDate, firstDueOnOrAfter, lastClosedCycle, type CardCycleConfig } from "@/domain/billing-cycle";
import { addDays, limaStartOfDayUtc, makeDate, parts, toLimaDate, type CalendarDate } from "@/domain/dates";
import { consolidate, negate, sumByCurrency, type ByCurrency, type Currency, type FxToBase } from "@/domain/money";
import { nextPayday } from "@/domain/payday";
import * as repo from "@/repositories/summary.repo";
import { lastSalaryAt } from "@/repositories/transactions.repo";

const LIQUID_TYPES = new Set(["checking", "cash", "wallet"]);
const BASE: Currency = "PEN";

export interface UpcomingItem {
  kind: "card" | "fixed";
  name: string;
  amountMinor: number;
  currency: Currency;
  dueDate: CalendarDate;
}

export interface CardUsage {
  id: string;
  name: string;
  last4: string;
  color: string;
  limitMinor: number;
  debt: ByCurrency;
  /** Deuda consolidada en la moneda de la línea; null si falta tipo de cambio. */
  usedMinor: number | null;
  usagePct: number | null;
}

export async function getHomeSummary(userId: string, now = new Date()) {
  const db = getDb();
  const today = toLimaDate(now);
  const { year, month } = parts(today);
  const monthFrom = limaStartOfDayUtc(makeDate(year, month, 1));
  const monthTo = limaStartOfDayUtc(makeDate(year, month + 1, 1));

  const [holidays, balances, totals, topCategories, cards, recurring, schedule, lastSalary, usd, recent, pendingReview] =
    await Promise.all([
      repo.holidaysBetween(db, addDays(today, -62), addDays(today, 120)),
      repo.accountBalances(db, userId),
      repo.monthTotals(db, userId, monthFrom, monthTo),
      repo.expensesByCategory(db, userId, monthFrom, monthTo),
      repo.listCreditCards(db, userId),
      repo.activeMonthlyRecurring(db, userId),
      repo.salarySchedule(db, userId),
      lastSalaryAt(db, userId),
      repo.latestUsdRate(db, today),
      repo.recentTransactions(db, userId),
      repo.reviewCount(db, userId),
    ]);

  const fx: FxToBase = usd ? { USD: usd.rate } : {};

  // ── Pagos de tarjeta: ciclo cerrado (estado por pagar) y ciclo abierto ──
  const cardPayments: CardPaymentDue[] = [];
  const cardUsage: CardUsage[] = [];
  for (const card of cards) {
    const cfg: CardCycleConfig = {
      closingDay: card.closingDay,
      dueDay: card.dueDay,
      closingAdjust: card.closingAdjust,
      dueAdjust: card.dueAdjust,
    };
    const last = lastClosedCycle(today, cfg, holidays);
    const open = cycleForDate(today, cfg, holidays);
    const bounds = {
      lastStart: limaStartOfDayUtc(last.periodStart),
      lastEnd: limaStartOfDayUtc(open.periodStart),
      openEnd: limaStartOfDayUtc(addDays(open.closingDate, 1)),
    };
    const cardAccounts = balances.filter((b) => b.creditCardId === card.id);

    for (const acct of cardAccounts) {
      const [sums, instLast, instOpen] = await Promise.all([
        repo.cardCycleSums(db, userId, acct.id, bounds),
        repo.installmentsDue(db, userId, card.id, acct.currency, last.closingDate),
        repo.installmentsDue(db, userId, card.id, acct.currency, open.closingDate),
      ]);
      // La deuda de apertura no está en `transactions`: se suma al ciclo que vence primero tras registrarla.
      const openingDebt = Math.max(0, -acct.openingBalanceMinor);
      const openingDue = openingDebt > 0 ? firstDueOnOrAfter(toLimaDate(acct.openingBalanceAt), cfg, holidays) : null;
      const lastDebt = Math.max(0, -sums.lastNet + instLast + (openingDue === last.dueDate ? openingDebt : 0));
      const openDebt = Math.max(0, -sums.openNet + instOpen + (openingDue === open.dueDate ? openingDebt : 0));
      const paid = sums.paymentsSinceClosing;
      const lastRemaining = Math.max(0, lastDebt - paid);
      const openRemaining = Math.max(0, openDebt - Math.max(0, paid - lastDebt));
      const label = cardAccounts.length > 1 ? `${card.name} (${acct.currency})` : card.name;
      if (lastRemaining > 0) cardPayments.push({ name: label, amount: { amountMinor: lastRemaining, currency: acct.currency }, dueDate: last.dueDate });
      if (openRemaining > 0) cardPayments.push({ name: `${label} · ciclo actual`, amount: { amountMinor: openRemaining, currency: acct.currency }, dueDate: open.dueDate });
    }

    const debt = negate(sumByCurrency(cardAccounts.map((a) => ({ amountMinor: a.balanceMinor, currency: a.currency }))));
    const usedMinor = consolidate(debt, card.limitCurrency, card.limitCurrency === BASE ? fx : {});
    cardUsage.push({
      id: card.id,
      name: card.name,
      last4: card.last4,
      color: card.color,
      limitMinor: card.limitMinor,
      debt,
      usedMinor,
      usagePct: usedMinor === null || card.limitMinor === 0 ? null : Math.round((Math.max(usedMinor, 0) / card.limitMinor) * 100),
    });
  }

  // ── Gastos fijos del mes (o del siguiente si ya se cobró) ──
  const fixedExpenses: FixedExpenseDue[] = recurring.map((r) => {
    const thisDue = makeDate(year, month, r.dueDay);
    const paidThisPeriod = r.lastChargedAt !== null && toLimaDate(r.lastChargedAt) >= addDays(thisDue, -7);
    return {
      name: r.name,
      amount: { amountMinor: r.amountMinor, currency: r.currency },
      dueDate: paidThisPeriod ? makeDate(year, month + 1, r.dueDay) : thisDue,
      paid: false,
      paidWithCreditCard: r.paymentAccountType === "credit_card",
    };
  });

  const payday = schedule
    ? nextPayday(today, { frequency: "monthly", ...schedule }, holidays, lastSalary ? toLimaDate(lastSalary) : null)
    : makeDate(year, month + 1, 1);

  const available: AvailableResult = availableUntilPayday({
    today,
    nextPayday: payday,
    liquidBalances: balances
      .filter((b) => LIQUID_TYPES.has(b.type))
      .map((b) => ({ amountMinor: b.balanceMinor, currency: b.currency })),
    fixedExpenses,
    cardPayments,
    baseCurrency: BASE,
    fxToBase: fx,
  });

  const horizon = addDays(today, 35);
  const upcoming: UpcomingItem[] = [
    ...cardPayments.map((c) => ({ kind: "card" as const, name: c.name, ...c.amount, dueDate: c.dueDate })),
    ...fixedExpenses
      .filter((f) => !f.paidWithCreditCard)
      .map((f) => ({ kind: "fixed" as const, name: f.name, ...f.amount, dueDate: f.dueDate })),
  ]
    .filter((u) => u.dueDate <= horizon)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6);

  const income: ByCurrency = {};
  const expenses: ByCurrency = {};
  for (const t of totals) {
    income[t.currency] = t.incomeMinor;
    expenses[t.currency] = t.expenseMinor;
  }
  const netWorth = sumByCurrency(
    balances.filter((b) => b.includeInNetWorth).map((b) => ({ amountMinor: b.balanceMinor, currency: b.currency })),
  );

  return {
    today,
    hasAccounts: balances.length > 0,
    month: { income, expenses, incomePen: consolidate(income, BASE, fx), expensesPen: consolidate(expenses, BASE, fx) },
    topCategories,
    available,
    nextPayday: payday,
    paydayConfigured: schedule !== null,
    upcoming,
    cards: cardUsage,
    netWorth: { byCurrency: netWorth, consolidatedPen: consolidate(netWorth, BASE, fx) },
    fx: usd,
    recent,
    pendingReview,
  };
}

export type HomeSummary = Awaited<ReturnType<typeof getHomeSummary>>;
