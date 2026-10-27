import { createHash, randomBytes } from "node:crypto";

const PREFIX = "ck_live_";
/** 32 bytes en base64url = 43 caracteres. */
const TOKEN_RE = /^ck_live_[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** El token en claro solo existe en este retorno: se muestra una vez y se guarda únicamente el hash. */
export function generateApiToken(): { token: string; prefix: string; hash: string } {
  const token = PREFIX + randomBytes(32).toString("base64url");
  return { token, prefix: token.slice(0, PREFIX.length + 6), hash: hashToken(token) };
}

/** Extrae el token de "Authorization: Bearer …"; null si falta o tiene formato inválido. */
export function extractBearer(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "");
  return m && TOKEN_RE.test(m[1]!) ? m[1]! : null;
}
