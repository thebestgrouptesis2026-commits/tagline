import { and, eq, inArray, isNull, ne } from "drizzle-orm";
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
 * - Sin últimos 4 (ej. "desde tu Cuenta de ahorro Soles"): la única cuenta de ese banco y moneda.
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
  if (!hint.last4) {
    const account = hint.bank ? await findUniqueBankAccount(ex, userId, hint.bank, hint.currency) : null;
    return account ? { account, currencyMismatch: false } : null;
  }

  const rows = await ex
    .select()
    .from(accounts)
    .where(and(live(userId), eq(accounts.last4, hint.last4), hint.bank ? eq(accounts.bank, hint.bank) : undefined))
    .limit(5);

  const sameCurrency = rows.filter((r) => r.currency === hint.currency);
  let found = sameCurrency.length === 1 ? sameCurrency[0] : rows.length === 1 ? rows[0] : undefined;
  // Cuenta registrada sin últimos 4: si es la única de ese banco y moneda, el correo es de ella.
  if (!found && rows.length === 0 && hint.bank) {
    const only = await findUniqueBankAccount(ex, userId, hint.bank, hint.currency);
    if (only && only.last4 === null) found = only;
  }
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

/** La única cuenta de ahorro/corriente/billetera de un banco en esa moneda (excluyendo `exceptId`); si hay 0 o varias, null. */
export async function findUniqueBankAccount(ex: Executor, userId: string, bank: string, currency: Currency, exceptId?: string) {
  const rows = await ex
    .select()
    .from(accounts)
    .where(
      and(
        live(userId),
        eq(accounts.bank, bank),
        eq(accounts.currency, currency),
        inArray(accounts.type, ["checking", "savings", "wallet"]),
        exceptId ? ne(accounts.id, exceptId) : undefined,
      ),
    )
    .limit(2);
  return rows.length === 1 ? rows[0]! : null;
}
