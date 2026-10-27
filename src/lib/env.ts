import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url(),
  AUTH_SECRET: z.string().min(32),
  ALLOWED_EMAILS: z
    .string()
    .min(3)
    .transform((s) => s.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)),
  AUTH_RESEND_KEY: z.string().optional(),
  AUTH_EMAIL_FROM: z.string().default("Ciclo <onboarding@resend.dev>"),
  CRON_SECRET: z.string().min(32),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validado en el primer uso (no en import) para que `next build` no exija secretos. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Variables de entorno inválidas o faltantes: ${missing}`);
  }
  cached = parsed.data;
  return cached;
}
