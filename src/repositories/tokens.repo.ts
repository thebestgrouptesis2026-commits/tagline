import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { apiTokens } from "@/db/schema";

/**
 * Única consulta sin `userId`: es la que lo resuelve a partir del token.
 * Busca por hash (índice único), así que no hay comparación de secretos en memoria.
 */
export async function findActiveTokenByHash(ex: Executor, tokenHash: string) {
  const [row] = await ex
    .select({ id: apiTokens.id, userId: apiTokens.userId, scope: apiTokens.scope, prefix: apiTokens.prefix })
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.tokenHash, tokenHash),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function touchToken(ex: Executor, userId: string, tokenId: string) {
  await ex
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)));
}

export async function insertToken(
  ex: Executor,
  userId: string,
  values: { name: string; prefix: string; tokenHash: string; scope: "ingest:all" | "ingest:manual" },
) {
  const [row] = await ex.insert(apiTokens).values({ userId, ...values }).returning({ id: apiTokens.id });
  return row!;
}
