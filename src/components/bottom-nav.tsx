"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  {
    href: "/",
    label: "Inicio",
    icon: <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />,
  },
  {
    href: "/movimientos",
    label: "Movimientos",
    icon: <path d="M5 7h14M5 12h14M5 17h9" />,
  },
  {
    href: "/revision",
    label: "Revisión",
    icon: <path d="M4 13.5V18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4.5M4 13.5 6.5 6h11l2.5 7.5M4 13.5h4.5l1 2h5l1-2H20" />,
  },
] as const;

/** Barra inferior fija: en el iPhone queda sobre el indicador de inicio gracias a safe-area. */
export function BottomNav({ reviewCount }: { reviewCount: number }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-canvas/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <ul className="mx-auto flex max-w-xl">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-16 flex-col items-center justify-center gap-1 text-xs ${active ? "text-fg" : "text-muted"}`}
              >
                <span className="relative">
                  <svg
                    viewBox="0 0 24 24"
                    className="size-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={active ? 2 : 1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    {t.icon}
                  </svg>
                  {t.href === "/revision" && reviewCount > 0 ? (
                    <span className="num absolute -top-1 -right-2.5 grid h-4 min-w-4 place-items-center rounded-pill bg-warning px-1 text-[10px] leading-none font-medium text-canvas">
                      {reviewCount > 99 ? "99+" : reviewCount}
                    </span>
                  ) : null}
                </span>
                {t.label}
                {t.href === "/revision" && reviewCount > 0 ? <span className="sr-only"> ({reviewCount} pendientes)</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
