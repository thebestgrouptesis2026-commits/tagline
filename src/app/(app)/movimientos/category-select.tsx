"use client";

import { useState, useTransition } from "react";
import { setCategory } from "./actions";

export function CategorySelect({
  transactionId,
  value,
  options,
}: {
  transactionId: string;
  value: string | null;
  options: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  return (
    <label className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted">Categoría</span>
      <span className="flex items-center gap-2">
        {error ? <span className="text-expense">No se guardó</span> : null}
        <select
          defaultValue={value ?? ""}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value || null;
            setError(false);
            start(async () => {
              const r = await setCategory(transactionId, next);
              if (!r.ok) setError(true);
            });
          }}
          className="h-10 rounded-control border border-line bg-surface px-3 text-fg disabled:opacity-50"
        >
          <option value="">Sin categoría</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
