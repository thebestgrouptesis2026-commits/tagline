import { describe, expect, it } from "vitest";
import { cycleForDate, cycleForInstant, lastClosedCycle, type CardCycleConfig } from "./billing-cycle";
import { PERU_HOLIDAY_SET } from "./holidays-pe";

/** BCP iO (corte 26) — antes llamada `interbank` en estos tests. Pago 20 del mes siguiente, se adelanta si cae en no hábil. */
const interbank: CardCycleConfig = { closingDay: 26, dueDay: 20, closingAdjust: "none", dueAdjust: "previous" };
const H = PERU_HOLIDAY_SET;

describe("cycleForDate — Interbank (corte 26 / pago 20)", () => {
  it("compra a mitad de ciclo", () => {
    expect(cycleForDate("2026-10-15", interbank, H)).toEqual({
      periodStart: "2026-09-27",
      closingDate: "2026-10-26",
      dueDate: "2026-11-20", // viernes, hábil
    });
  });

  it("el día del corte pertenece al ciclo que cierra ese día", () => {
    expect(cycleForDate("2026-10-26", interbank, H).closingDate).toBe("2026-10-26");
  });

  it("el día después del corte abre el ciclo siguiente", () => {
    expect(cycleForDate("2026-10-27", interbank, H)).toEqual({
      periodStart: "2026-10-27",
      closingDate: "2026-11-26",
      // 20/12/2026 es domingo → sábado 19 → viernes 18
      dueDate: "2026-12-18",
    });
  });

  it("usa la hora de Lima, no UTC: 22:30 del 26 en Lima ya es 27 en UTC", () => {
    const instant = new Date("2026-10-27T03:30:00Z");
    expect(cycleForInstant(instant, interbank, H).closingDate).toBe("2026-10-26");
  });

  it("cruza el año", () => {
    expect(cycleForDate("2026-12-27", interbank, H)).toEqual({
      periodStart: "2026-12-27",
      closingDate: "2027-01-26",
      dueDate: "2027-02-19", // 20/02/2027 es sábado
    });
  });

  it("adelanta el vencimiento si cae en feriado", () => {
    const holidays = new Set(["2026-11-20"]);
    expect(cycleForDate("2026-10-10", interbank, holidays).dueDate).toBe("2026-11-19");
  });

  it("lastClosedCycle devuelve el estado de cuenta por pagar", () => {
    expect(lastClosedCycle("2026-11-05", interbank, H)).toEqual({
      periodStart: "2026-09-27",
      closingDate: "2026-10-26",
      dueDate: "2026-11-20",
    });
  });
});

describe("cycleForDate — meses cortos y vencimiento en el mismo mes", () => {
  const endOfMonth: CardCycleConfig = { closingDay: 31, dueDay: 25, closingAdjust: "none", dueAdjust: "previous" };

  it("corte 31 en febrero se recorta al 28", () => {
    expect(cycleForDate("2027-02-10", endOfMonth, H)).toEqual({
      periodStart: "2027-02-01",
      closingDate: "2027-02-28",
      // 25 <= 28 → mes siguiente; 25/03/2027 es Jueves Santo → miércoles 24
      dueDate: "2027-03-24",
    });
  });

  it("1 de marzo cae en el ciclo que cierra el 31 de marzo", () => {
    expect(cycleForDate("2027-03-01", endOfMonth, H)).toMatchObject({
      periodStart: "2027-03-01",
      closingDate: "2027-03-31",
    });
  });

  it("año bisiesto: corte el 29 de febrero", () => {
    expect(cycleForDate("2028-02-29", endOfMonth, H).closingDate).toBe("2028-02-29");
  });

  it("pago después del corte dentro del mismo mes", () => {
    const card: CardCycleConfig = { closingDay: 5, dueDay: 25, closingAdjust: "none", dueAdjust: "previous" };
    expect(cycleForDate("2026-10-03", card, H)).toEqual({
      periodStart: "2026-09-06",
      closingDate: "2026-10-05",
      dueDate: "2026-10-23", // 25/10/2026 es domingo
    });
  });
});

/** Interbank Visa Clásica: corte 27, pago 20 del mes siguiente. */
const interbank27: CardCycleConfig = { closingDay: 27, dueDay: 20, closingAdjust: "none", dueAdjust: "previous" };

describe("cycleForDate — Interbank (corte 27 / pago 20)", () => {
  it("el 27 todavía es del ciclo que cierra ese día", () => {
    expect(cycleForDate("2026-10-27", interbank27, H)).toEqual({
      periodStart: "2026-09-28",
      closingDate: "2026-10-27",
      dueDate: "2026-11-20",
    });
  });

  it("el 28 abre el ciclo siguiente (se paga el 18/12 porque el 20/12 es domingo)", () => {
    expect(cycleForDate("2026-10-28", interbank27, H)).toEqual({
      periodStart: "2026-10-28",
      closingDate: "2026-11-27",
      dueDate: "2026-12-18",
    });
  });

  it("el 26 cae en un ciclo distinto según la tarjeta (iO ya cerró, Interbank no)", () => {
    expect(cycleForDate("2026-10-26", interbank, H).closingDate).toBe("2026-10-26");
    expect(cycleForDate("2026-10-27", interbank, H).closingDate).toBe("2026-11-26");
    expect(cycleForDate("2026-10-27", interbank27, H).closingDate).toBe("2026-10-27");
  });
});
