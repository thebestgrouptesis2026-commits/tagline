import Link from "next/link";
import { labelForKind } from "@/components/kind-label";
import { Amount, AmountByCurrency, monthLabel, shortDate } from "@/components/money";
import { getDb } from "@/db/client";
import { addDays, dayOfWeek, limaStartOfDayUtc, makeDate, toLimaDate } from "@/domain/dates";
import { EXPENSE_KINDS, INCOME_KINDS, INTERNAL_KINDS } from "@/domain/ledger";
import type { ByCurrency } from "@/domain/money";
import { requireUserId } from "@/lib/auth";
import { listAccountsForFilter, listCategories, listMovements } from "@/repositories/movements.repo";
import { AutoSubmitSelect } from "./auto-submit-select";
import { CategorySelect } from "./category-select";

export const dynamic = "force-dynamic";
export const metadata = { title: "Movimientos · Ciclo" };

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const income = new Set<string>(INCOME_KINDS);
const expense = new Set<string>(EXPENSE_KINDS);
const internal = new Set<string>(INTERNAL_KINDS);

type Params = { mes?: string; cuenta?: string; tipo?: string; q?: string };

export default async function MovementsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const userId = await requireUserId();
  const params = await searchParams;
  const today = toLimaDate(new Date());
  const current = today.slice(0, 7);
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.mes ?? "") && params.mes! <= current ? params.mes! : current;
  const [year, month] = mes.split("-").map(Number) as [number, number];
  const tipo = params.tipo === "gastos" || params.tipo === "ingresos" ? params.tipo : undefined;
  const cuenta = /^[0-9a-f-]{36}$/i.test(params.cuenta ?? "") ? params.cuenta : undefined;
  const q = params.q?.trim().slice(0, 60) || undefined;

  const db = getDb();
  const [rows, accountOptions, categoryOptions] = await Promise.all([
    listMovements(db, userId, {
      from: limaStartOfDayUtc(makeDate(year, month, 1)),
      to: limaStartOfDayUtc(makeDate(year, month + 1, 1)),
      accountId: cuenta,
      type: tipo,
      q,
    }),
    listAccountsForFilter(db, userId),
    listCategories(db, userId),
  ]);

  // Totales del filtro: sin transferencias entre tus cuentas ni movimientos por revisar.
  const totalIncome: ByCurrency = {};
  const totalExpense: ByCurrency = {};
  for (const r of rows) {
    if (r.status !== "posted" || r.isTransferLeg) continue;
    if (income.has(r.kind) && r.amountMinor > 0) totalIncome[r.currency] = (totalIncome[r.currency] ?? 0) + r.amountMinor;
    if (expense.has(r.kind)) totalExpense[r.currency] = (totalExpense[r.currency] ?? 0) - r.amountMinor;
  }

  const days = new Map<string, typeof rows>();
  for (const r of rows) {
    const day = toLimaDate(r.occurredAt);
    days.set(day, [...(days.get(day) ?? []), r]);
  }

  const href = (patch: Partial<Params>) => {
    const next = { mes: mes === current ? undefined : mes, cuenta, tipo, q, ...patch };
    const sp = new URLSearchParams(Object.entries(next).filter((e): e is [string, string] => !!e[1]));
    const s = sp.toString();
    return s ? `/movimientos?${s}` : "/movimientos";
  };
  const shiftMonth = (n: number) => makeDate(year, month + n, 1).slice(0, 7);
  const dayLabel = (day: string) =>
    day === today ? "Hoy" : day === addDays(today, -1) ? "Ayer" : `${WEEKDAYS[dayOfWeek(day)]} ${shortDate(day)}`;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 px-4 pt-[max(env(safe-area-inset-top),20px)] pb-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-medium tracking-tight">Movimientos</h1>
        <nav aria-label="Mes" className="flex items-center gap-1">
          <Link href={href({ mes: shiftMonth(-1) })} aria-label="Mes anterior" className="grid size-10 place-items-center rounded-pill text-muted hover:text-fg">
            ‹
          </Link>
          <span className="stamp min-w-28 text-center">{monthLabel(`${mes}-01`)}</span>
          {mes < current ? (
            <Link href={href({ mes: shiftMonth(1) })} aria-label="Mes siguiente" className="grid size-10 place-items-center rounded-pill text-muted hover:text-fg">
              ›
            </Link>
          ) : (
            <span className="size-10" aria-hidden />
          )}
        </nav>
      </header>

      <form action="/movimientos" className="flex flex-col gap-3">
        {mes !== current ? <input type="hidden" name="mes" value={mes} /> : null}
        {tipo ? <input type="hidden" name="tipo" value={tipo} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar comercio o nota"
          className="h-11 rounded-control border border-line bg-surface px-3 text-base placeholder:text-muted"
        />
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-1 rounded-pill border border-line p-1 text-sm" role="group" aria-label="Tipo">
            {[
              { value: undefined, label: "Todos" },
              { value: "gastos", label: "Gastos" },
              { value: "ingresos", label: "Ingresos" },
            ].map((o) => (
              <Link
                key={o.label}
                href={href({ tipo: o.value })}
                aria-current={tipo === o.value ? "true" : undefined}
                className={`flex-1 rounded-pill py-1.5 text-center ${tipo === o.value ? "bg-surface-2 text-fg" : "text-muted"}`}
              >
                {o.label}
              </Link>
            ))}
          </div>
          <AutoSubmitSelect
            name="cuenta"
            defaultValue={cuenta ?? ""}
            aria-label="Cuenta"
            className="h-10 max-w-40 rounded-pill border border-line bg-surface px-3 text-sm"
          >
            <option value="">Todas las cuentas</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </AutoSubmitSelect>
          <noscript>
            <button type="submit" className="h-10 rounded-pill border border-line px-3 text-sm">
              Filtrar
            </button>
          </noscript>
        </div>
      </form>

      <dl className="grid grid-cols-2 gap-4 border-y border-line py-4">
        <div>
          <dt className="text-sm text-muted">Ingresos</dt>
          <dd className="mt-1 text-xl font-light">
            <AmountByCurrency value={totalIncome} tone="income" />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Gastos</dt>
          <dd className="mt-1 text-xl font-light">
            <AmountByCurrency value={totalExpense} />
          </dd>
        </div>
      </dl>

      {rows.length === 0 ? (
        <p className="text-muted">
          {q || cuenta || tipo ? "Nada coincide con estos filtros." : "No hay movimientos en este mes."}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {[...days].map(([day, list]) => (
            <section key={day} aria-label={dayLabel(day)} className="flex flex-col">
              <h2 className="stamp pb-2 text-muted">{dayLabel(day)}</h2>
              <ul className="divide-y divide-line">
                {list.map((t) => {
                  const kindFor = income.has(t.kind) ? "income" : "expense";
                  const canCategorize = !internal.has(t.kind) && !t.isTransferLeg;
                  return (
                    <li key={t.id}>
                      <details className="group">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3 [&::-webkit-details-marker]:hidden">
                          <span className="flex min-w-0 items-center gap-3">
                            <span className="size-2.5 shrink-0 rounded-full" style={{ background: t.accountColor }} aria-hidden />
                            <span className="min-w-0">
                              <span className="block truncate">{t.merchant ?? t.categoryName ?? labelForKind(t.kind)}</span>
                              <span className="block truncate text-sm text-muted">
                                {t.categoryName ?? labelForKind(t.kind)} · {t.accountName}
                                {t.status === "pending_review" ? <span className="text-warning"> · por revisar</span> : null}
                              </span>
                            </span>
                          </span>
                          <Amount
                            minor={t.amountMinor}
                            currency={t.currency}
                            tone={t.amountMinor > 0 ? "income" : "plain"}
                            sign={t.amountMinor > 0}
                            className={t.isTransferLeg ? "text-muted" : ""}
                          />
                        </summary>
                        <div className="mb-3 flex flex-col gap-3 rounded-card bg-surface p-4">
                          {canCategorize ? (
                            <CategorySelect
                              transactionId={t.id}
                              value={t.categoryId}
                              options={categoryOptions.filter((c) => c.kind === kindFor)}
                            />
                          ) : null}
                          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                            <dt className="text-muted">Tipo</dt>
                            <dd className="text-right">{t.isTransferLeg ? "Entre tus cuentas" : labelForKind(t.kind)}</dd>
                            <dt className="text-muted">Hora</dt>
                            <dd className="num text-right">
                              {t.occurredAt.toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit" })}
                            </dd>
                            <dt className="text-muted">Origen</dt>
                            <dd className="text-right">{SOURCES[t.source] ?? t.source}</dd>
                            {t.description ? (
                              <>
                                <dt className="text-muted">Detalle</dt>
                                <dd className="text-right break-words">{t.description}</dd>
                              </>
                            ) : null}
                            {t.note ? (
                              <>
                                <dt className="text-muted">Nota</dt>
                                <dd className="text-right break-words">{t.note}</dd>
                              </>
                            ) : null}
                          </dl>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {rows.length >= 300 ? <p className="text-sm text-muted">Se muestran los 300 más recientes del mes. Usa los filtros para acotar.</p> : null}
        </div>
      )}
    </main>
  );
}

const SOURCES: Record<string, string> = {
  email: "Correo del banco",
  sms: "SMS",
  manual: "Registro manual",
  recurring: "Recurrente",
  import: "Importado",
};
