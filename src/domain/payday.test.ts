import { describe, expect, it } from "vitest";
import { PERU_HOLIDAY_SET } from "./holidays-pe";
import { matchesSalary, nextPayday, type MonthlyPaySchedule } from "./payday";

const sueldo: MonthlyPaySchedule = { frequency: "monthly", expectedDay: 27, payAdjust: "previous" };
const H = PERU_HOLIDAY_SET;

describe("nextPayday", () => {
  it("devuelve el 27 del mes en curso", () => {
    expect(nextPayday("2026-11-10", sueldo, H)).toBe("2026-11-27");
  });

  it("hoy es día de pago y aún no llega: sigue siendo hoy", () => {
    expect(nextPayday("2026-11-27", sueldo, H, "2026-10-27")).toBe("2026-11-27");
  });

  it("si el sueldo ya llegó, salta al mes siguiente (27/12 domingo, 25 feriado → 24)", () => {
    expect(nextPayday("2026-11-27", sueldo, H, "2026-11-27")).toBe("2026-12-24");
  });

  it("sueldo adelantado dentro de la ventana cuenta como recibido", () => {
    expect(nextPayday("2026-11-25", sueldo, H, "2026-11-25")).toBe("2026-12-24");
  });

  it("pasada la fecha, apunta al mes siguiente", () => {
    expect(nextPayday("2026-11-28", sueldo, H, "2026-11-27")).toBe("2026-12-24");
  });
});

describe("matchesSalary", () => {
  const source = {
    expectedAmountMinor: 132_000,
    currency: "PEN" as const,
    amountTolerancePct: 10,
    destinationAccountId: "bcp",
    keywords: ["PLANILLA"],
  };

  it("por palabra clave", () => {
    expect(matchesSalary({ amountMinor: 50_000, currency: "PEN", accountId: "otra", text: "Abono Planilla" }, source)).toBe(true);
  });

  it("por monto dentro de la tolerancia en la cuenta esperada", () => {
    expect(matchesSalary({ amountMinor: 128_000, currency: "PEN", accountId: "bcp", text: "Abono" }, source)).toBe(true);
  });

  it("monto fuera de tolerancia o en otra moneda no es sueldo", () => {
    expect(matchesSalary({ amountMinor: 5_000, currency: "PEN", accountId: "bcp", text: "Abono" }, source)).toBe(false);
    expect(matchesSalary({ amountMinor: 132_000, currency: "USD", accountId: "bcp", text: "PLANILLA" }, source)).toBe(false);
  });
});
