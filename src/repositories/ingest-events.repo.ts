import { and, between, eq, or } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { ingestEvents } from "@/db/schema";

export type IngestEventRow = typeof ingestEvents.$inferSelect;
type NewEvent = Omit<typeof ingestEvents.$inferInsert, "userId" | "id">;
type EventPatch = Partial<Pick<IngestEventRow, "status" | "parserId" | "parserVersion" | "confidence" | "parsed" | "error" | "replyText">>;

export async function findDuplicate(ex: Executor, userId: string, contentHash: string, idempotencyKey: string | null) {
  const match = idempotencyKey
    ? or(eq(ingestEvents.contentHash, contentHash), eq(ingestEvents.idempotencyKey, idempotencyKey))
    : eq(ingestEvents.contentHash, contentHash);
  const [row] = await ex
    .select()
    .from(ingestEvents)
    .where(and(eq(ingestEvents.userId, userId), match))
    .limit(1);
  return row ?? null;
}

/** null si otra petición concurrente ya insertó el mismo hash o Idempotency-Key. */
export async function insertEvent(ex: Executor, userId: string, values: NewEvent) {
  const [row] = await ex
    .insert(ingestEvents)
    .values({ ...values, userId })
    .onConflictDoNothing()
    .returning({ id: ingestEvents.id });
  return row ?? null;
}

export async function updateEvent(ex: Executor, userId: string, id: string, patch: EventPatch) {
  await ex
    .update(ingestEvents)
    .set(patch)
    .where(and(eq(ingestEvents.id, id), eq(ingestEvents.userId, userId)));
}

/** Eventos en revisión recibidos cerca de `around` (para cerrar el aviso de entrada de una transferencia propia). */
export async function listReviewEventsNear(ex: Executor, userId: string, around: Date, windowMs: number) {
  return ex
    .select({ id: ingestEvents.id, parsed: ingestEvents.parsed })
    .from(ingestEvents)
    .where(
      and(
        eq(ingestEvents.userId, userId),
        eq(ingestEvents.status, "needs_review"),
        between(ingestEvents.receivedAt, new Date(around.getTime() - windowMs), new Date(around.getTime() + windowMs)),
      ),
    );
}
