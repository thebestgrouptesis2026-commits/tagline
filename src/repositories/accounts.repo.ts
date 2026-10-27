import { and, eq, isNull } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { accounts } from "@/db/schema";
import type { Currency } from "@/domain/money";
import type { AccountHint } from "@/parsers/types";

export type AccountRow = typeof accounts.$inferSelect;

const live = (userId: string) => and(eq(accounts.userId, userId), isNull(accounts.deletedAt));

async function byId(ex: Executor, userId: string, id: string) {
  const [row] = await ex.select().from(accounts).where(and(live(userId), eq(accounts.id, id))).limit(1);
  return row ?? null;
}

/**
 * Cuenta propia a partir de la pista del parser.
 * - Efectivo: la cuenta `cash` en esa moneda.
 * - Últimos 4: si hay varias (tarjeta bimoneda), elige la de la moneda; si hay una sola, la usa.
 * - Una tarjeta de débito se resuelve a su cuenta vinculada (el saldo vive ahí).
 * Ambiguo o sin datos → null (el movimiento va a revisión).
 */
export async function findAccountForHint(
  ex: Executor,
  userId: string,
  hint: AccountHint,
): Promise<{ account: AccountRow; currencyMismatch: boolean } | null> {
  if (hint.type === "cash") {
    const account = await findCashAccount(ex, userId, hint.currency);
    return account ? { account, currencyMismatch: false } : null;
  }
  if (!hint.last4) return null;

  const rows = await ex
    .select()
    .from(accounts)
    .where(and(live(userId), eq(accounts.last4, hint.last4), hint.bank ? eq(accounts.bank, hint.bank) : undefined))
    .limit(5);

  const sameCurrency = rows.filter((r) => r.currency === hint.currency);
  const found = sameCurrency.length === 1 ? sameCurrency[0] : rows.length === 1 ? rows[0] : undefined;
  if (!found) return null;

  const account = found.type === "debit_card" && found.parentAccountId ? await byId(ex, userId, found.parentAccountId) : found;
  return account ? { account, currencyMismatch: account.currency !== hint.currency } : null;
}

export async function findAccountByLast4(ex: Executor, userId: string, last4: string, currency: Currency) {
  const rows = await ex
    .select()
    .from(accounts)
    .where(and(live(userId), eq(accounts.last4, last4), eq(accounts.currency, currency)))
    .limit(2);
  return rows.length === 1 ? rows[0]! : null;
}

export async function findCashAccount(ex: Executor, userId: string, currency: Currency) {
  const [row] = await ex
    .select()
    .from(accounts)
    .where(and(live(userId), eq(accounts.type, "cash"), eq(accounts.currency, currency)))
    .limit(1);
  return row ?? null;
}
