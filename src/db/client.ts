import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// Driver WebSocket (no HTTP) porque la ingesta necesita transacciones interactivas.
// El Pool se reutiliza entre invocaciones calientes de la función.
// Lee DATABASE_URL directo (no `env()`) para que los scripts locales no exijan los secretos de la app.
function create() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL");
  return drizzle({ client: new Pool({ connectionString }), schema });
}

export type Db = ReturnType<typeof create>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Cualquier cosa sobre la que se puede consultar: la conexión o una transacción abierta. */
export type Executor = Db | Tx;

let db: Db | null = null;

export function getDb(): Db {
  db ??= create();
  return db;
}
