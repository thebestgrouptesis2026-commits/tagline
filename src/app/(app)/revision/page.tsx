import { labelForKind } from "@/components/kind-label";
import { Amount, shortDate } from "@/components/money";
import { getDb } from "@/db/client";
import { toLimaDate } from "@/domain/dates";
import { INCOME_KINDS, INTERNAL_KINDS } from "@/domain/ledger";
import { requireUserId } from "@/lib/auth";
import type { ParsedMovement } from "@/parsers/types";
import { listCategories } from "@/repositories/movements.repo";
import { listOwnAccounts, listReviewItems, type ReviewItem } from "@/repositories/review.repo";
import { DecideForm, RegisterForm, type RegisterDefaults } from "./review-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revisión · Ciclo" };

const SOURCES: Record<string, string> = { email: "Correo", sms: "SMS", manual: "Manual" };
const income = new Set<string>(INCOME_KINDS);
const internal = new Set<string>(INTERNAL_KINDS);

type Accounts = Awaited<ReturnType<typeof listOwnAccounts>>;

export default async function ReviewPage() {
  const userId = await requireUserId();
  const db = getDb();
  const [items, accounts, categories] = await Promise.all([listReviewItems(db, userId), listOwnAccounts(db, userId), listCategories(db, userId)]);
  const today = toLimaDate(new Date());

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 px-4 pt-[max(env(safe-area-inset-top),20px)] pb-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-medium tracking-tight">Revisión</h1>
        <p className="text-sm text-muted">
          Mensajes que la app no pudo registrar sola. Confírmalos, complétalos o descártalos; el mensaje original siempre queda guardado.
        </p>
      </header>

      {items.length === 0 ? (
        <section className="flex flex-col gap-2 rounded-card border border-line p-6">
          <h2 className="font-display text-3xl italic">Todo al día.</h2>
          <p className="text-muted">No hay nada por revisar.</p>
        </section>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id}>
              <ReviewCard item={item} accounts={accounts} categories={categories} today={today} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function ReviewCard({
  item,
  accounts,
  categories,
  today,
}: {
  item: ReviewItem;
  accounts: Accounts;
  categories: Awaited<ReturnType<typeof listCategories>>;
  today: string;
}) {
  const received = toLimaDate(item.receivedAt);
  const time = item.receivedAt.toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit" });
  const title = (item.replyText ?? "Mensaje sin procesar").replace(/^Revisar:\s*/, "");
  // La pata "principal" es la que sale de tu cuenta (o la única); la espejo no se categoriza.
  const main = item.transactions[0] ?? null;
  const categorizable = main && !internal.has(main.kind) && item.transactions.length === 1;

  return (
    <article className="flex flex-col gap-4 rounded-card border border-line p-5">
      <header className="flex flex-col gap-1">
        <span className="stamp text-muted">
          {received === today ? "Hoy" : shortDate(received)} · {time} · {SOURCES[item.source] ?? item.source}
        </span>
        <h2 className="text-lg leading-snug first-letter:uppercase">{title}</h2>
        {item.error ? <p className="text-sm text-muted">Motivo: {item.error}</p> : null}
      </header>

      {item.transactions.length > 0 ? (
        <ul className="divide-y divide-line rounded-control bg-surface px-4">
          {item.transactions.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-4 py-3">
              <span className="min-w-0">
                <span className="block truncate">{t.merchant ?? labelForKind(t.kind)}</span>
                <span className="block truncate text-sm text-muted">
                  {t.categoryName ?? labelForKind(t.kind)} · {t.accountName}
                </span>
              </span>
              <Amount minor={t.amountMinor} currency={t.currency} tone={t.amountMinor > 0 ? "income" : "plain"} sign={t.amountMinor > 0} />
            </li>
          ))}
        </ul>
      ) : null}

      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Ver mensaje original</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-control bg-surface p-3 font-mono text-xs whitespace-pre-wrap wrap-break-word">
          {item.rawText}
        </pre>
      </details>

      {main ? (
        <DecideForm
          eventId={item.id}
          transactionId={categorizable ? main.id : null}
          categoryId={main.categoryId}
          categories={categories.filter((c) => c.kind === (income.has(main.kind) ? "income" : "expense"))}
        />
      ) : (
        <RegisterForm
          eventId={item.id}
          defaults={defaultsFor(item, accounts, received)}
          today={today}
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
          categories={categories}
        />
      )}
    </article>
  );
}

/** Rellena el formulario con lo que el parser alcanzó a leer (monto, fecha, comercio y una cuenta probable). */
function defaultsFor(item: ReviewItem, accounts: Accounts, received: string): RegisterDefaults {
  const mv = item.parsed as Partial<ParsedMovement> | null;
  const kind = mv?.kind;
  // Con titular solo llegan aquí las transferencias contigo mismo (las de terceros se registran solas).
  const selfTransfer = (kind === "transfer_out" || kind === "transfer_in") && !!mv?.counterparty?.holder;
  const type: RegisterDefaults["type"] =
    kind && (internal.has(kind) || selfTransfer) ? "transferencia" : kind && income.has(kind) ? "ingreso" : "gasto";
  const hint = mv?.account;
  const byLast4 = hint?.last4 ? accounts.filter((a) => a.last4 === hint.last4) : [];
  const byBank = hint?.bank ? accounts.filter((a) => a.bank === hint.bank && a.currency === hint.currency && a.type !== "credit_card") : [];
  const guess = byLast4.length === 1 ? byLast4[0] : byBank.length === 1 ? byBank[0] : undefined;
  const occurred = mv?.occurredAt ? toLimaDate(new Date(mv.occurredAt)) : received;
  return {
    type,
    amount: typeof mv?.amountMinor === "number" ? (mv.amountMinor / 100).toFixed(2) : "",
    date: occurred,
    // En una entrada desde otra cuenta tuya, la cuenta del correo es el destino; el origen lo eliges tú.
    accountId: type === "transferencia" && kind === "transfer_in" ? "" : (guess?.id ?? ""),
    toAccountId: type === "transferencia" && kind === "transfer_in" ? (guess?.id ?? "") : "",
    merchant: mv?.merchant ?? "",
  };
}
