import { BottomNav } from "@/components/bottom-nav";

/** Pantallas con sesión: todas comparten la barra inferior. El espacio de abajo evita que la barra tape el contenido. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="pb-[calc(env(safe-area-inset-bottom)+4rem)]">{children}</div>
      <BottomNav />
    </>
  );
}
