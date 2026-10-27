import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Passkey from "next-auth/providers/passkey";
import Resend from "next-auth/providers/resend";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { authAccounts, authenticators, authSessions, users, verificationTokens } from "@/db/schema";
import { env } from "./env";

// Inicialización perezosa: la config (y la BD) se resuelven en la primera petición, no al importar.
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const e = env();
  return {
    adapter: DrizzleAdapter(getDb(), {
      usersTable: users,
      accountsTable: authAccounts,
      sessionsTable: authSessions,
      verificationTokensTable: verificationTokens,
      authenticatorsTable: authenticators,
    }),
    // 1er acceso: enlace por correo. Luego se registra una passkey (Face ID) desde la app.
    providers: [Resend({ apiKey: e.AUTH_RESEND_KEY, from: e.AUTH_EMAIL_FROM }), Passkey],
    experimental: { enableWebAuthn: true },
    session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
    pages: { signIn: "/login", verifyRequest: "/login?enviado=1", error: "/login" },
    callbacks: {
      // Lista blanca: nadie más puede crear cuenta aunque conozca la URL.
      signIn: ({ user }) => !!user.email && e.ALLOWED_EMAILS.includes(user.email.toLowerCase()),
    },
  };
});

/** Para Server Components y Server Actions: devuelve el userId o redirige al login. */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  return id;
}
