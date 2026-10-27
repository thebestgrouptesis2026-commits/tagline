/**
 * Feriados nacionales de Perú (Ley 31822 y anteriores). Semilla para la tabla `holidays`.
 * Revisar cada diciembre: el Ejecutivo puede declarar feriados o días no laborables nuevos
 * y Semana Santa cambia cada año.
 */
export const PERU_HOLIDAYS: ReadonlyArray<{ day: string; name: string }> = [
  { day: "2026-01-01", name: "Año Nuevo" },
  { day: "2026-04-02", name: "Jueves Santo" },
  { day: "2026-04-03", name: "Viernes Santo" },
  { day: "2026-05-01", name: "Día del Trabajo" },
  { day: "2026-06-07", name: "Batalla de Arica y Día de la Bandera" },
  { day: "2026-06-29", name: "San Pedro y San Pablo" },
  { day: "2026-07-23", name: "Día de la Fuerza Aérea del Perú" },
  { day: "2026-07-28", name: "Fiestas Patrias" },
  { day: "2026-07-29", name: "Fiestas Patrias" },
  { day: "2026-08-06", name: "Batalla de Junín" },
  { day: "2026-08-30", name: "Santa Rosa de Lima" },
  { day: "2026-10-08", name: "Combate de Angamos" },
  { day: "2026-11-01", name: "Todos los Santos" },
  { day: "2026-12-08", name: "Inmaculada Concepción" },
  { day: "2026-12-09", name: "Batalla de Ayacucho" },
  { day: "2026-12-25", name: "Navidad" },
  { day: "2027-01-01", name: "Año Nuevo" },
  { day: "2027-03-25", name: "Jueves Santo" },
  { day: "2027-03-26", name: "Viernes Santo" },
  { day: "2027-05-01", name: "Día del Trabajo" },
  { day: "2027-06-07", name: "Batalla de Arica y Día de la Bandera" },
  { day: "2027-06-29", name: "San Pedro y San Pablo" },
  { day: "2027-07-23", name: "Día de la Fuerza Aérea del Perú" },
  { day: "2027-07-28", name: "Fiestas Patrias" },
  { day: "2027-07-29", name: "Fiestas Patrias" },
  { day: "2027-08-06", name: "Batalla de Junín" },
  { day: "2027-08-30", name: "Santa Rosa de Lima" },
  { day: "2027-10-08", name: "Combate de Angamos" },
  { day: "2027-11-01", name: "Todos los Santos" },
  { day: "2027-12-08", name: "Inmaculada Concepción" },
  { day: "2027-12-09", name: "Batalla de Ayacucho" },
  { day: "2027-12-25", name: "Navidad" },
];

export const PERU_HOLIDAY_SET: ReadonlySet<string> = new Set(PERU_HOLIDAYS.map((h) => h.day));
