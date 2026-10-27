import { z } from "zod";
import { getDb } from "@/db/client";
import { extractBearer, hashToken } from "@/lib/api-token";
import { errorResponse, HttpError, json, readJsonBody, validationError } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { findActiveTokenByHash } from "@/repositories/tokens.repo";
import { ingest } from "@/services/ingest.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT = { limit: 30, windowSeconds: 60 };

const bodySchema = z.object({
  source: z.enum(["sms", "email", "manual"]),
  sender: z.string().trim().min(1).max(200),
  raw_text: z.string().min(1).max(12_000),
  received_at: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
  device_id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
}).strict();

const idempotencyKeySchema = z.string().trim().min(1).max(128).nullable();

export async function POST(req: Request): Promise<Response> {
  try {
    const raw = extractBearer(req.headers.get("authorization"));
    if (!raw) throw new HttpError(401, "unauthorized", "Token ausente o inválido");
    const token = await findActiveTokenByHash(getDb(), hashToken(raw));
    if (!token) throw new HttpError(401, "unauthorized", "Token ausente o inválido");

    const rl = await consumeRateLimit(`ingest:${token.id}`, RATE_LIMIT.limit, RATE_LIMIT.windowSeconds);
    if (!rl.ok) {
      throw new HttpError(429, "rate_limited", "Demasiadas peticiones", undefined, { "Retry-After": String(rl.retryAfter) });
    }

    const parsed = bodySchema.safeParse(await readJsonBody(req, MAX_BODY_BYTES));
    if (!parsed.success) throw validationError(parsed.error);
    const body = parsed.data;

    const now = Date.now();
    const at = body.received_at.getTime();
    if (at > now + 10 * 60_000 || at < now - 7 * 86_400_000) {
      throw new HttpError(400, "validation_error", "received_at fuera de rango (máx. 7 días atrás, 10 min adelante)");
    }

    const idem = idempotencyKeySchema.safeParse(req.headers.get("idempotency-key"));
    if (!idem.success) throw validationError(idem.error);

    const result = await ingest({
      userId: token.userId,
      tokenId: token.id,
      tokenScope: token.scope,
      source: body.source,
      sender: body.sender,
      rawText: body.raw_text,
      receivedAt: body.received_at,
      idempotencyKey: idem.data,
    });
    return json(result.body, result.httpStatus);
  } catch (err) {
    return errorResponse(err, "POST /api/v1/ingest");
  }
}
