import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Las migraciones usan la conexión DIRECTA (sin pooler): DATABASE_URL_UNPOOLED.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "" },
  strict: true,
});
