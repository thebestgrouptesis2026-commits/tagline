/**
 * Crea un token de dispositivo para el webhook. Se muestra UNA vez; en la BD solo queda su hash.
 *   npm run token:create -- "Gmail Apps Script"
 *   npm run token:create -- "iPhone Atajos" manual     ← solo puede registrar efectivo
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { generateApiToken } from "@/lib/api-token";
import { insertToken } from "@/repositories/tokens.repo";

async function main() {
  const [name, scopeArg] = process.argv.slice(2);
  const email = process.env.SEED_EMAIL?.toLowerCase();
  if (!name || !email) throw new Error('Uso: npm run token:create -- "<nombre>" [manual]  (requiere SEED_EMAIL en .env)');

  const db = getDb();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error(`No existe el usuario ${email}. Ejecuta primero npm run db:seed.`);

  const { token, prefix, hash } = generateApiToken();
  const scope = scopeArg === "manual" ? "ingest:manual" : "ingest:all";
  await insertToken(db, user.id, { name, prefix, tokenHash: hash, scope });

  console.log(`\nToken "${name}" (${scope}). Cópialo ahora, no se vuelve a mostrar:\n\n  ${token}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
