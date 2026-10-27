/**
 * Un ciclo casi cerrado: el arco es el mes, el punto violeta es "hoy" avanzando hacia el próximo sueldo.
 * El arco usa currentColor para adaptarse al tema; el punto es el único acento de marca.
 */
export const LOGO_SVG = (arc: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="22" fill="none" stroke="${arc}" stroke-width="7" stroke-linecap="round" stroke-dasharray="118 200" transform="rotate(-50 32 32)"/><circle cx="46.1" cy="15.1" r="5.5" fill="#af50ff"/></svg>`;

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Ciclo">
      <circle
        cx="32"
        cy="32"
        r="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray="118 200"
        transform="rotate(-50 32 32)"
      />
      <circle cx="46.1" cy="15.1" r="5.5" fill="#af50ff" />
    </svg>
  );
}
