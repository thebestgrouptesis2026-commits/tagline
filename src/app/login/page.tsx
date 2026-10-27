import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { PasskeySignIn } from "@/components/passkey-buttons";
import { auth, signIn } from "@/lib/auth";

export const metadata = { title: "Entrar · Ciclo" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ enviado?: string; error?: string }> }) {
  if ((await auth())?.user) redirect("/");
  const { enviado, error } = await searchParams;

  async function sendLink(formData: FormData) {
    "use server";
    await signIn("resend", { email: String(formData.get("email") ?? ""), redirectTo: "/" });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-10 px-4">
      <div className="flex items-center gap-3">
        <Logo className="size-10" />
        <span className="text-2xl font-medium tracking-tight">Ciclo</span>
      </div>

      <h1 className="font-display text-5xl leading-[0.95] italic">
        Todo tu dinero, <span className="not-italic font-sans font-light">en un solo lugar.</span>
      </h1>

      {enviado ? (
        <p className="rounded-card border border-line p-5 text-muted">Te enviamos un enlace. Ábrelo en este dispositivo.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <PasskeySignIn />
          <div className="stamp text-center text-muted">o</div>
          <form action={sendLink} className="flex flex-col gap-3">
            <label htmlFor="email" className="sr-only">Correo</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="tu@correo.com"
              className="h-12 rounded-control border border-line bg-surface px-4 outline-none focus:border-fg"
            />
            <button type="submit" className="h-12 rounded-control border border-fg font-medium">
              Enviarme un enlace
            </button>
          </form>
          {error ? <p role="alert" className="text-sm text-expense">No se pudo iniciar sesión con ese correo.</p> : null}
        </div>
      )}
    </main>
  );
}
