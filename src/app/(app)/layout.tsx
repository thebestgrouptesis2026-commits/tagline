import { BottomNav } from "@/components/bottom-nav";
import { getDb } from "@/db/client";
import { auth } from "@/lib/auth";
import { reviewCount } from "@/repositories/summary.repo";

/** Pantallas con sesión: todas comparten la barra inferior. El espacio de abajo evita que la barra tape el contenido. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Cada página exige sesión por su cuenta; aquí solo se usa para el contador de Revisión.
  const userId = (await auth())?.user?.id;
  const pending = userId ? await reviewCount(getDb(), userId) : 0;
  return (
    <>
      <div className="pb-[calc(env(safe-area-inset-bottom)+4rem)]">{children}</div>
      <BottomNav reviewCount={pending} />
    </>
  );
}
