import { randomUUID } from "node:crypto";
import type { ZodError } from "zod";
import { log } from "./logger";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export function validationError(err: ZodError): HttpError {
  return new HttpError(
    400,
    "validation_error",
    err.issues[0]?.message ?? "Cuerpo inválido",
    err.issues.map((i) => ({ path: i.path.join("."), issue: i.code })),
  );
}

export function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** Convierte cualquier error en la respuesta estándar `{ error: { code, message } }` sin filtrar internos. */
export function errorResponse(err: unknown, route: string): Response {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message, details: err.details } }, err.status, err.headers);
  }
  const requestId = randomUUID();
  log("error", "unhandled", { route, requestId, error: err instanceof Error ? err.message : String(err) });
  return json({ error: { code: "internal_error", message: "Error interno", requestId } }, 500);
}

/** Lee JSON con límite de tamaño real (no solo Content-Length, que el cliente puede mentir). */
export async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Se espera application/json");
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, "payload_too_large", `Máximo ${maxBytes} bytes`);

  const buf = await req.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new HttpError(413, "payload_too_large", `Máximo ${maxBytes} bytes`);
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new HttpError(400, "validation_error", "JSON mal formado");
  }
}
