/**
 * Semilla inicial: usuario, categorías, reglas, feriados, cuentas, tarjetas y sueldo.
 * Uso: copia scripts/seed.config.example.json → scripts/seed.config.json, complétalo y ejecuta `npm run db:seed`.
 * Es re-ejecutable: no duplica cuentas si el usuario ya tiene alguna.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  accounts,
  categories,
  categorizationRules,
  creditCards,
  exchangeRates,
  holidays,
  incomeSources,
  users,
} from "@/db/schema";
import { toLimaDate } from "@/domain/dates";
import { PERU_HOLIDAYS } from "@/domain/holidays-pe";
import { parseAmountToMinor, type Currency } from "@/domain/money";

interface SeedConfig {
  email: string;
  accounts: Array<{
    key: string;
    type: "checking" | "savings" | "cash" | "wallet" | "debit_card";
    name: string;
    bank?: string;
    currency: Currency;
    last4?: string;
    openingBalance?: string;
    color?: string;
    parent?: string;
    /** Las cuentas de ahorro no cuentan para "disponible" salvo que lo indiques (se guardan como checking). */
    liquid?: boolean;
  }>;
  creditCards: Array<{
    bank: string;
    name: string;
    network: "visa" | "mastercard" | "amex" | "diners";
    last4: string;
    limit: string;
    closingDay: number;
    dueDay: number;
    currencies: Currency[];
    installmentTea?: string;
    openingDebt?: Partial<Record<Currency, string>>;
    color?: string;
  }>;
  salary?: { amount: string; day: number; account: string; keywords: string[] };
  usdRate?: string;
}

const EXPENSE = ["Comida", "Supermercado", "Transporte", "Compras", "Salud", "Entretenimiento", "Servicios", "Suscripciones", "Vivienda", "Educación", "Transferencias", "Otros"];
const INCOME = ["Sueldo", "Ventas", "Freelance", "Reembolsos", "Intereses", "Otros ingresos"];
const RULES: Array<[pattern: string, category: string]> = [
  ["PLAZA VEA", "Supermercado"], ["TOTTUS", "Supermercado"], ["WONG", "Supermercado"], ["METRO", "Supermercado"],
  ["MAKRO", "Supermercado"], ["MASS", "Supermercado"],
  ["UBER", "Transporte"], ["CABIFY", "Transporte"], ["DIDI", "Transporte"], ["INDRIVE", "Transporte"],
  ["RAPPI", "Comida"], ["PEDIDOSYA", "Comida"], ["KFC", "Comida"], ["BEMBOS", "Comida"], ["STARBUCKS", "Comida"],
  ["NETFLIX", "Suscripciones"], ["SPOTIFY", "Suscripciones"], ["DISNEY", "Suscripciones"], ["APPLE COM BILL", "Suscripciones"],
  ["INKAFARMA", "Salud"], ["MIFARMA", "Salud"],
  ["LUZ DEL SUR", "Servicios"], ["ENEL", "Servicios"], ["SEDAPAL", "Servicios"], ["CLARO", "Servicios"], ["MOVISTAR", "Servicios"], ["ENTEL", "Servicios"],
  ["FALABELLA", "Compras"], ["RIPLEY", "Compras"], ["OECHSLE", "Compras"], ["MERCADOLIBRE", "Compras"],
];

function minor(value: string | undefined, field: string): number {
  if (value === undefined) return 0;
  const n = parseAmountToMinor(value);
  if (n === null) throw new Error(`Monto inválido en ${field}: ${value}`);
  return n;
}

async function main() {
  const config = JSON.parse(readFileSync(new URL("./seed.config.json", import.meta.url), "utf8")) as SeedConfig;
  const db = getDb();

  await db.insert(holidays).values(PERU_HOLIDAYS.map((h) => ({ ...h, country: "PE" }))).onConflictDoNothing();

  const [user] = await db
    .insert(users)
    .values({ email: config.email.toLowerCase(), name: config.email.split("@")[0] })
    .onConflictDoUpdate({ target: users.email, set: { email: config.email.toLowerCase() } })
    .returning({ id: users.id });
  const userId = user!.id;

  const existing = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.userId, userId)).limit(1);
  if (existing.length > 0) {
    console.log("El usuario ya tiene cuentas; solo se actualizaron feriados. Nada más que hacer.");
    return;
  }

  await db.transaction(async (tx) => {
    const cats = await tx
      .insert(categories)
      .values([
        ...EXPENSE.map((name, i) => ({ userId, name, kind: "expense" as const, sortOrder: i })),
        ...INCOME.map((name, i) => ({ userId, name, kind: "income" as const, sortOrder: i })),
      ])
      .returning({ id: categories.id, name: categories.name, kind: categories.kind });
    const catId = (name: string, kind: "expense" | "income" = "expense") => cats.find((c) => c.name === name && c.kind === kind)!.id;

    await tx.insert(categorizationRules).values(
      RULES.map(([pattern, category]) => ({ userId, pattern, categoryId: catId(category), match: "contains" as const })),
    );

    const ids = new Map<string, string>();
    // Primero las cuentas sin padre, luego las tarjetas de débito que las referencian.
    for (const a of [...config.accounts].sort((x, y) => Number(!!x.parent) - Number(!!y.parent))) {
      const [row] = await tx
        .insert(accounts)
        .values({
          userId,
          type: a.type === "savings" && a.liquid ? "checking" : a.type,
          name: a.name,
          bank: a.bank ?? null,
          currency: a.currency,
          last4: a.last4 ?? null,
          parentAccountId: a.parent ? ids.get(a.parent) ?? null : null,
          openingBalanceMinor: minor(a.openingBalance, `${a.key}.openingBalance`),
          color: a.color ?? "#828384",
          includeInNetWorth: a.type !== "debit_card",
        })
        .returning({ id: accounts.id });
      ids.set(a.key, row!.id);
    }

    for (const c of config.creditCards) {
      const [card] = await tx
        .insert(creditCards)
        .values({
          userId,
          bank: c.bank,
          name: c.name,
          network: c.network,
          last4: c.last4,
          limitMinor: minor(c.limit, `${c.name}.limit`),
          closingDay: c.closingDay,
          dueDay: c.dueDay,
          dueAdjust: "previous",
          defaultInstallmentTea: c.installmentTea ?? null,
          color: c.color ?? "#af50ff",
        })
        .returning({ id: creditCards.id });
      for (const currency of c.currencies) {
        await tx.insert(accounts).values({
          userId,
          type: "credit_card",
          name: c.currencies.length > 1 ? `${c.name} (${currency})` : c.name,
          bank: c.bank,
          currency,
          last4: c.last4,
          creditCardId: card!.id,
          // La deuda inicial se guarda negativa: es lo que debes.
          openingBalanceMinor: -minor(c.openingDebt?.[currency], `${c.name}.openingDebt.${currency}`),
          color: c.color ?? "#af50ff",
        });
      }
    }

    if (config.salary) {
      await tx.insert(incomeSources).values({
        userId,
        name: "Sueldo",
        isSalary: true,
        categoryId: catId("Sueldo", "income"),
        expectedAmountMinor: minor(config.salary.amount, "salary.amount"),
        currency: "PEN",
        frequency: "monthly",
        expectedDay: config.salary.day,
        payAdjust: "previous",
        destinationAccountId: ids.get(config.salary.account) ?? null,
        keywords: config.salary.keywords,
      });
    }

    if (config.usdRate) {
      await tx
        .insert(exchangeRates)
        .values({ day: toLimaDate(new Date()), base: "USD", quote: "PEN", rate: config.usdRate, source: "manual" })
        .onConflictDoNothing();
    }
  });

  console.log(`Listo: usuario ${config.email} con ${config.accounts.length} cuentas y ${config.creditCards.length} tarjeta(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
