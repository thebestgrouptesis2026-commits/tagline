"use client";

import { useActionState, useState } from "react";
import { decide, register, type ActionState } from "./actions";

type Option = { id: string; name: string };
type AccountOption = Option & { currency: string };
type CategoryOption = Option & { kind: "expense" | "income" };

const initial: ActionState = { error: null };
const field = "h-11 w-full rounded-control border border-line bg-canvas px-3 text-base text-fg";
const primary = "h-11 flex-1 rounded-pill bg-fg font-medium text-canvas disabled:opacity-50";
const secondary = "h-11 rounded-pill border border-line px-5 text-muted disabled:opacity-50";

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-expense">
      {error}
    </p>
  ) : null;
}

/** La app creó el movimiento pero con poca confianza: confirmarlo tal cual (o con otra categoría) o descartarlo. */
export function DecideForm({
  eventId,
  transactionId,
  categoryId,
  categories,
}: {
  eventId: string;
  /** null cuando no aplica categoría (pagos de tarjeta, transferencias propias). */
  transactionId: string | null;
  categoryId: string | null;
  categories: Option[];
}) {
  const [state, action, pending] = useActionState(decide, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="eventId" value={eventId} />
      {transactionId ? (
        <>
          <input type="hidden" name="transactionId" value={transactionId} />
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">Categoría</span>
            <select name="categoryId" defaultValue={categoryId ?? ""} className={field}>
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      <ErrorLine error={state.error} />
      <div className="flex gap-2">
        <button type="submit" name="intent" value="confirm" disabled={pending} className={primary}>
          Confirmar
        </button>
        <button type="submit" name="intent" value="discard" disabled={pending} className={secondary}>
          Descartar
        </button>
      </div>
    </form>
  );
}

export interface RegisterDefaults {
  type: "gasto" | "ingreso" | "transferencia";
  amount: string;
  date: string;
  accountId: string;
  toAccountId: string;
  merchant: string;
}

/** La app no pudo leer el mensaje o no supo la cuenta: lo completas tú. */
export function RegisterForm({
  eventId,
  defaults,
  today,
  accounts,
  categories,
}: {
  eventId: string;
  defaults: RegisterDefaults;
  today: string;
  accounts: AccountOption[];
  categories: CategoryOption[];
}) {
  const [state, action, pending] = useActionState(register, initial);
  const [type, setType] = useState(defaults.type);
  const kind = type === "ingreso" ? "income" : "expense";

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="eventId" value={eventId} />
      <fieldset className="flex gap-1 rounded-pill border border-line p-1 text-sm">
        <legend className="sr-only">Tipo</legend>
        {(
          [
            ["gasto", "Gasto"],
            ["ingreso", "Ingreso"],
            ["transferencia", "Entre mis cuentas"],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className={`flex-1 cursor-pointer rounded-pill py-1.5 text-center has-focus-visible:outline-2 ${type === value ? "bg-surface-2 text-fg" : "text-muted"}`}
          >
            <input
              type="radio"
              name="type"
              value={value}
              checked={type === value}
              onChange={() => setType(value)}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">Monto</span>
          <input name="amount" inputMode="decimal" defaultValue={defaults.amount} placeholder="0.00" required className={`${field} num`} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">Fecha</span>
          <input type="date" name="date" defaultValue={defaults.date} max={today} required className={field} />
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted">{type === "transferencia" ? "Desde" : "Cuenta"}</span>
        <select name="accountId" defaultValue={defaults.accountId} required className={field}>
          <option value="" disabled>
            Elige una cuenta
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.currency}
            </option>
          ))}
        </select>
      </label>

      {type === "transferencia" ? (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">Hacia</span>
          <select name="toAccountId" defaultValue={defaults.toAccountId} required className={field}>
            <option value="" disabled>
              Elige la cuenta destino
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">{type === "ingreso" ? "De quién" : "Comercio"} (opcional)</span>
            <input name="merchant" defaultValue={defaults.merchant} maxLength={80} className={field} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">Categoría</span>
            <select key={kind} name="categoryId" defaultValue="" className={field}>
              <option value="">Sin categoría</option>
              {categories
                .filter((c) => c.kind === kind)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}

      <ErrorLine error={state.error} />
      <div className="flex gap-2">
        <button type="submit" name="intent" value="register" disabled={pending} className={primary}>
          Registrar
        </button>
        <button type="submit" name="intent" value="discard" disabled={pending} formNoValidate className={secondary}>
          Descartar
        </button>
      </div>
    </form>
  );
}
