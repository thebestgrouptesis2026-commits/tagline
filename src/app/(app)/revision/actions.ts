"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { confirmEvent, discardEvent, registerFromEvent, type ReviewResult } from "@/services/review.service";

export type ActionState = { error: string | null };

const uuid = z.uuid();
const optionalUuid = z.preprocess((v) => (v === "" || v == null ? null : v), z.uuid().nullable());

function done(r: ReviewResult): ActionState {
  if (!r.ok) return { error: r.error };
  refresh();
  return { error: null };
}

/** Movimiento que la app sí creó: confirmarlo (con su categoría) o descartarlo. */
export async function decide(_: ActionState, form: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const eventId = uuid.safeParse(form.get("eventId"));
  if (!eventId.success) return { error: "Solicitud inválida." };
  if (form.get("intent") === "discard") return done(await discardEvent(userId, eventId.data));

  const transactionId = form.get("transactionId");
  if (transactionId === null) return done(await confirmEvent(userId, eventId.data));
  const category = z.object({ transactionId: uuid, categoryId: optionalUuid }).safeParse({
    transactionId,
    categoryId: form.get("categoryId"),
  });
  if (!category.success) return { error: "Categoría no válida." };
  return done(await confirmEvent(userId, eventId.data, category.data));
}

const manual = z.object({
  eventId: uuid,
  type: z.enum(["gasto", "ingreso", "transferencia"]),
  amount: z.string().trim().min(1, "Escribe el monto."),
  date: z.iso.date("Fecha inválida."),
  accountId: z.uuid("Elige la cuenta."),
  toAccountId: optionalUuid,
  categoryId: optionalUuid,
  merchant: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null), z.string().nullable()),
});

/** Lo que la app no pudo leer o asignar: lo registras tú (o lo descartas). */
export async function register(_: ActionState, form: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  if (form.get("intent") === "discard") {
    const eventId = uuid.safeParse(form.get("eventId"));
    return eventId.success ? done(await discardEvent(userId, eventId.data)) : { error: "Solicitud inválida." };
  }
  const parsed = manual.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  const { eventId, ...input } = parsed.data;
  return done(await registerFromEvent(userId, eventId, input));
}
