import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { rateLimits } from "@/db/schema";

/**
 * Ventana fija en Postgres: un upsert atómico por petición. Suficiente para un usuario
 * y sin dependencias extra; si algún día hay tráfico real, cambiar por Upstash Redis.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const windowMs = windowSeconds * 1000;
  const startMs = Math.floor(Date.now() / windowMs) * windowMs;
  const [row] = await getDb()
    .insert(rateLimits)
    .values({ key, windowStart: new Date(startMs), count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  if ((row?.count ?? 0) <= limit) return { ok: true };
  return { ok: false, retryAfter: Math.ceil((startMs + windowMs - Date.now()) / 1000) };
}
