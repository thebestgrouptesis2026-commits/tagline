import { Logo } from "@/components/logo";
import { Amount, AmountByCurrency, monthLabel, shortDate } from "@/components/money";
import { PasskeyRegister } from "@/components/passkey-buttons";
import { diffDays, toLimaDate } from "@/domain/dates";
import { requireUserId } from "@/lib/auth";
import { getHomeSummary, type HomeSummary } from "@/services/summary.service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const userId = await requireUserId();
  const s = await getHomeSummary(userId);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-12 px-4 pt-[max(env(safe-area-inset-top),20px)] pb-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo className="size-7" />
          <span className="text-lg font-medium tracking-tight">Ciclo</span>
        </div>
        <span className="stamp text-muted">{monthLabel(s.today)}</span>
      </header>

      {s.pendingReview > 0 ? (
        <p role="status" className="-mt-6 flex items-center gap-3 rounded-card border border-line px-4 py-3 text-sm">
          <span className="size-2 shrink-0 rounded-full bg-warning" aria-hidden />
          {s.pendingReview === 1 ? "1 movimiento por revisar" : `${s.pendingReview} movimientos por revisar`}
        </p>
      ) : null}

      {s.hasAccounts ? <Dashboard s={s} /> : <EmptyState />}

      <footer className="flex items-center justify-between border-t border-line pt-6 text-sm text-muted">
        <PasskeyRegister />
        <span className="stamp">Lima −12.05, −77.04</span>
      </footer>
    </main>
  );
}

function Dashboard({ s }: { s: HomeSummary }) {
  const a = s.available;
  const days = a.daysUntilPayday;
  const hasUsd = (a.byCurrency.USD ?? 0) !== 0;

  return (
    <>
      {/* Disponible: el único bloque con la señal violeta. */}
      <section aria-labelledby="disp" className="relative overflow-hidden rounded-card border border-line p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-20 size-64 rounded-full bg-brand-fill opacity-25 blur-3xl"
        />
        <h2 id="disp" className="stamp text-muted">
          Disponible hasta el {shortDate(s.nextPayday)}
          {!s.paydayConfigured ? " (sin sueldo configurado)" : ""}
        </h2>
        <p className="mt-4 text-5xl leading-none font-light tracking-tight sm:text-6xl">
          {a.consolidated ? (
            <Amount minor={a.consolidated.amountMinor} currency="PEN" tone={a.consolidated.amountMinor < 0 ? "expense" : "plain"} />
          ) : (
            <AmountByCurrency value={a.byCurrency} />
          )}
        </p>
        {hasUsd && a.consolidated ? (
          <p className="mt-2 text-sm text-muted">
            Incluye <Amount minor={a.byCurrency.USD!} currency="USD" /> al TC {s.fx?.rate}
          </p>
        ) : null}
        <p className="mt-3 text-muted">
          {days === 0 ? "El sueldo llega hoy" : `${days} ${days === 1 ? "día" : "días"}`}
          {a.perDayMinor !== null && days > 0 ? (
            <>
              {" · "}
              <Amount minor={a.perDayMinor} currency="PEN" /> por día
            </>
          ) : null}
        </p>
        <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
          <Stat label="Saldo" value={a.breakdown.balance} />
          <Stat label="Fijos" value={a.breakdown.pendingFixed} negative />
          <Stat label="Tarjetas" value={a.breakdown.cardPayments} negative />
        </dl>
      </section>

      <section aria-labelledby="mes" className="flex flex-col gap-5">
        <h2 id="mes" className="stamp text-muted">Este mes</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted">Ingresos</div>
            <div className="mt-1 text-2xl font-light">
              <AmountByCurrency value={s.month.income} tone="income" />
            </div>
          </div>
          <div>
            <div className="text-sm text-muted">Gastos</div>
            <div className="mt-1 text-2xl font-light">
              <AmountByCurrency value={s.month.expenses} />
            </div>
          </div>
        </div>
        <SplitBar income={s.month.incomePen} expenses={s.month.expensesPen} />
        {s.topCategories.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {s.topCategories.map((c) => (
              <li key={`${c.categoryId ?? "none"}-${c.currency}`} className="flex items-baseline justify-between gap-4">
                <span className="truncate">{c.name}</span>
                <Amount minor={c.totalMinor} currency={c.currency} className="text-muted" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Sin gastos registrados este mes.</p>
        )}
      </section>

      <section aria-labelledby="prox" className="flex flex-col gap-4">
        <h2 id="prox" className="stamp text-muted">Próximos pagos</h2>
        {s.upcoming.length > 0 ? (
          <ul className="divide-y divide-line">
            {s.upcoming.map((u) => {
              const inDays = diffDays(s.today, u.dueDate);
              return (
                <li key={`${u.kind}-${u.name}-${u.dueDate}`} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate">{u.name}</div>
                    <div className={`text-sm ${inDays <= 2 ? "text-warning" : "text-muted"}`}>
                      {inDays < 0 ? `Vencido el ${shortDate(u.dueDate)}` : inDays === 0 ? "Vence hoy" : `${shortDate(u.dueDate)} · en ${inDays} d`}
                    </div>
                  </div>
                  <Amount minor={u.amountMinor} currency={u.currency} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted">Nada por pagar en las próximas 5 semanas.</p>
        )}
      </section>

      {s.cards.length > 0 ? (
        <section aria-labelledby="tarj" className="flex flex-col gap-4">
          <h2 id="tarj" className="stamp text-muted">Tarjetas</h2>
          {s.cards.map((c) => (
            <div key={c.id} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-4">
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: c.color }} aria-hidden />
                  {c.name} <span className="text-muted">··{c.last4}</span>
                </span>
                <span className="text-sm text-muted">
                  <AmountByCurrency value={c.debt} />
                </span>
              </div>
              {c.usagePct !== null ? (
                <>
                  <div
                    className="h-1.5 overflow-hidden rounded-pill bg-surface-2"
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={c.usagePct}
                    aria-label={`Uso de línea ${c.name}`}
                  >
                    <div
                      className={`h-full rounded-pill ${c.usagePct >= 70 ? "bg-warning" : "bg-fg"}`}
                      style={{ width: `${Math.min(c.usagePct, 100)}%` }}
                    />
                  </div>
                  <div className="text-sm text-muted">
                    {c.usagePct}% de <Amount minor={c.limitMinor} currency="PEN" /> usado
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted">Agrega el tipo de cambio para ver el uso de línea.</div>
              )}
            </div>
          ))}
        </section>
      ) : null}

      <section aria-labelledby="mov" className="flex flex-col gap-4">
        <h2 id="mov" className="stamp text-muted">Últimos movimientos</h2>
        {s.recent.length > 0 ? (
          <ul className="divide-y divide-line">
            {s.recent.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: t.accountColor }} aria-hidden />
                  <div className="min-w-0">
                    <div className="truncate">{t.merchant ?? t.categoryName ?? labelForKind(t.kind)}</div>
                    <div className="truncate text-sm text-muted">
                      {shortDate(toLimaDate(t.occurredAt))} · {t.accountName}
                      {t.status === "pending_review" ? <span className="text-warning"> · por revisar</span> : null}
                    </div>
                  </div>
                </div>
                <Amount minor={t.amountMinor} currency={t.currency} tone={t.amountMinor > 0 ? "income" : "plain"} sign={t.amountMinor > 0} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Los movimientos aparecerán aquí en cuanto llegue el primer correo del banco.</p>
        )}
      </section>

      <section aria-labelledby="pat" className="flex items-baseline justify-between gap-4 border-t border-line pt-6">
        <h2 id="pat" className="stamp text-muted">Patrimonio neto</h2>
        <span className="text-xl font-light">
          {s.netWorth.consolidatedPen !== null ? (
            <Amount minor={s.netWorth.consolidatedPen} currency="PEN" />
          ) : (
            <AmountByCurrency value={s.netWorth.byCurrency} />
          )}
        </span>
      </section>
    </>
  );
}

function Stat({ label, value, negative = false }: { label: string; value: Partial<Record<"PEN" | "USD", number>>; negative?: boolean }) {
  const pen = value.PEN ?? 0;
  const usd = value.USD ?? 0;
  return (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 truncate">
        <Amount minor={negative ? -pen : pen} currency="PEN" />
        {usd !== 0 ? (
          <span className="block text-muted">
            <Amount minor={negative ? -usd : usd} currency="USD" />
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function SplitBar({ income, expenses }: { income: number | null; expenses: number | null }) {
  if (income === null || expenses === null || income + expenses <= 0) return null;
  const pct = Math.round((income / (income + Math.max(expenses, 0))) * 100);
  const saved = income > 0 ? Math.round(((income - expenses) / income) * 100) : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-1.5 overflow-hidden rounded-pill bg-surface-2" aria-hidden>
        <div className="bg-income" style={{ width: `${pct}%` }} />
        <div className="flex-1 bg-expense opacity-70" />
      </div>
      {saved !== null ? (
        <div className="text-sm text-muted">{saved >= 0 ? `Ahorras el ${saved}% de lo que ganas` : `Gastas ${-saved}% más de lo que ganas`}</div>
      ) : null}
    </div>
  );
}

function labelForKind(kind: string): string {
  const labels: Record<string, string> = {
    salary: "Sueldo",
    deposit: "Depósito",
    income_other: "Ingreso",
    transfer_in: "Transferencia recibida",
    transfer_out: "Transferencia enviada",
    cash_withdrawal: "Retiro de efectivo",
    card_payment: "Pago de tarjeta",
    refund: "Devolución",
    fee: "Comisión",
    interest: "Interés",
    purchase: "Compra",
  };
  return labels[kind] ?? "Movimiento";
}

function EmptyState() {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-line p-6">
      <h2 className="font-display text-3xl italic">Empecemos.</h2>
      <p className="text-muted">
        Aún no hay cuentas. Completa <code className="font-mono text-fg">scripts/seed.config.json</code> y ejecuta{" "}
        <code className="font-mono text-fg">npm run db:seed</code> para crear tus cuentas, tarjeta y sueldo.
      </p>
    </section>
  );
}
