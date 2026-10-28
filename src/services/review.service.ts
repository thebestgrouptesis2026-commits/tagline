import { getDb } from "@/db/client";
import { normalizeMerchant } from "@/domain/categorize";
import { limaStartOfDayUtc, toLimaDate } from "@/domain/dates";
import { signedAmount } from "@/domain/ledger";
import { manualKinds, type ManualType } from "@/domain/manual-entry";
import { parseAmountToMinor } from "@/domain/money";
import { updateEvent } from "@/repositories/ingest-events.repo";
import { recategorize } from "@/repositories/movements.repo";
import { findReviewEvent, listOwnAccounts, setEventTransactionsStatus } from "@/repositories/review.repo";
import { insertTransaction, linkTransfer } from "@/repositories/transactions.repo";

export type ReviewResult = { ok: true } | { ok: false; error: string };

const GONE: ReviewResult = { ok: false, error: "Este movimiento ya fue resuelto." };

/** Se lanza dentro de la transacción para deshacerla; se traduce a un mensaje al salir. */
class InvalidCategory extends Error {}
const BAD_CATEGORY: ReviewResult = { ok: false, error: "Categoría no válida." };

/** Da por bueno lo que leyó la app; opcionalmente corrige la categoría (y la aprende). */
export async function confirmEvent(
  userId: string,
  eventId: string,
  category?: { transactionId: string; categoryId: string | null },
): Promise<ReviewResult> {
  return getDb().transaction(async (tx) => {
    if (!(await findReviewEvent(tx, userId, eventId))) return GONE;
    if (category && !(await recategorize(tx, userId, category.transactionId, category.categoryId))) return BAD_CATEGORY;
    await setEventTransactionsStatus(tx, userId, eventId, "posted");
    await updateEvent(tx, userId, eventId, { status: "parsed" });
    return { ok: true } as const;
  });
}

/** No era un movimiento o está mal: se anula lo creado y el correo queda archivado como ignorado. */
export async function discardEvent(userId: string, eventId: string): Promise<ReviewResult> {
  return getDb().transaction(async (tx) => {
    if (!(await findReviewEvent(tx, userId, eventId))) return GONE;
    await setEventTransactionsStatus(tx, userId, eventId, "voided");
    await updateEvent(tx, userId, eventId, { status: "ignored" });
    return { ok: true };
  });
}

export interface ManualInput {
  type: ManualType;
  amount: string;
  date: string;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  merchant: string | null;
}

/** Para lo que la app no pudo leer o no supo a qué cuenta asignar: lo registras tú, ligado al correo original. */
export async function registerFromEvent(userId: string, eventId: string, input: ManualInput): Promise<ReviewResult> {
  const magnitude = parseAmountToMinor(input.amount);
  if (!magnitude) return { ok: false, error: "Monto inválido. Ejemplo: 25.90" };
  if (input.date > toLimaDate(new Date())) return { ok: false, error: "La fecha no puede ser futura." };

  return getDb()
    .transaction(async (tx): Promise<ReviewResult> => {
      const event = await findReviewEvent(tx, userId, eventId);
      if (!event) return GONE;

      const own = await listOwnAccounts(tx, userId);
      const from = own.find((a) => a.id === input.accountId);
      const to = input.type === "transferencia" ? own.find((a) => a.id === input.toAccountId) : undefined;
      if (!from) return { ok: false, error: "Elige la cuenta." };
      if (input.type === "transferencia") {
        if (!to) return { ok: false, error: "Elige la cuenta destino." };
        if (to.id === from.id) return { ok: false, error: "Origen y destino deben ser distintos." };
        if (to.currency !== from.currency) return { ok: false, error: "Ambas cuentas deben estar en la misma moneda." };
      }

      const { kind, mirrorKind } = manualKinds(input.type, from.type, to?.type ?? null);
      const amountMinor = signedAmount(kind, magnitude);
      // Si la fecha es la del correo, se conserva su hora; si la cambiaste, se registra al mediodía.
      const occurredAt =
        toLimaDate(event.receivedAt) === input.date
          ? event.receivedAt
          : new Date(limaStartOfDayUtc(input.date).getTime() + 12 * 3_600_000);
      const merchant = input.type === "transferencia" ? null : input.merchant;

      // Lo que la app había creado con datos dudosos se anula: lo reemplaza este registro.
      await setEventTransactionsStatus(tx, userId, eventId, "voided");

      const main = await insertTransaction(tx, userId, {
        accountId: from.id,
        kind,
        status: "posted",
        source: event.source,
        amountMinor,
        currency: from.currency,
        occurredAt,
        merchant,
        merchantNormalized: merchant ? normalizeMerchant(merchant) : null,
        ingestEventId: event.id,
        confidence: 1,
      });
      if (to && mirrorKind) {
        const mirror = await insertTransaction(tx, userId, {
          accountId: to.id,
          kind: mirrorKind,
          status: "posted",
          source: event.source,
          amountMinor: -amountMinor,
          currency: to.currency,
          occurredAt,
          merchant: from.name,
          merchantNormalized: normalizeMerchant(from.name),
          ingestEventId: event.id,
          confidence: 1,
        });
        await linkTransfer(tx, userId, main.id, mirror.id);
      }
      // recategorize valida que la categoría sea tuya y aprende la regla del comercio.
      if (input.type !== "transferencia" && input.categoryId && !(await recategorize(tx, userId, main.id, input.categoryId))) {
        throw new InvalidCategory();
      }

      await updateEvent(tx, userId, eventId, { status: "parsed" });
      return { ok: true };
    })
    .catch((err: unknown) => {
      if (err instanceof InvalidCategory) return BAD_CATEGORY;
      throw err;
    });
}
