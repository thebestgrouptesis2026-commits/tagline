import { describe, expect, it } from "vitest";
import { availableUntilPayday, type AvailableInput } from "./available";

const base: AvailableInput = {
  today: "2026-11-10",
  nextPayday: "2026-11-27",
  liquidBalances: [
    { amountMinor: 200_000, currency: "PEN" }, // BCP sueldo
    { amountMinor: 15_000, currency: "PEN" }, // efectivo
  ],
  fixedExpenses: [
    { name: "Internet", amount: { amountMinor: 8_990, currency: "PEN" }, dueDate: "2026-11-15", paid: false, paidWithCreditCard: false },
    { name: "Netflix", amount: { amountMinor: 4_490, currency: "PEN" }, dueDate: "2026-11-12", paid: false, paidWithCreditCard: true },
    { name: "Alquiler", amount: { amountMinor: 60_000, currency: "PEN" }, dueDate: "2026-11-01", paid: true, paidWithCreditCard: false },
    { name: "Gimnasio", amount: { amountMinor: 9_900, currency: "PEN" }, dueDate: "2026-11-28", paid: false, paidWithCreditCard: false },
  ],
  cardPayments: [
    { name: "Visa Interbank", amount: { amountMinor: 81_680, currency: "PEN" }, dueDate: "2026-11-20" },
    { name: "Visa Interbank (ciclo abierto)", amount: { amountMinor: 30_000, currency: "PEN" }, dueDate: "2026-12-18" },
  ],
  baseCurrency: "PEN",
  fxToBase: { USD: "3.7520" },
};

describe("availableUntilPayday", () => {
  it("resta fijos pendientes y pagos de tarjeta antes del sueldo", () => {
    const r = availableUntilPayday(base);
    // 2,150.00 − 89.90 (internet) − 816.80 (tarjeta) = 1,243.30
    expect(r.byCurrency).toEqual({ PEN: 124_330 });
    expect(r.consolidated).toEqual({ currency: "PEN", amountMinor: 124_330 });
    expect(r.commitments.map((c) => c.name)).toEqual(["Internet", "Visa Interbank"]);
    expect(r.daysUntilPayday).toBe(17);
    expect(r.perDayMinor).toBe(Math.floor(124_330 / 17));
  });

  it("excluye lo cargado a tarjeta (ya está en el pago), lo pagado y lo que vence en o después del sueldo", () => {
    const names = availableUntilPayday(base).commitments.map((c) => c.name);
    expect(names).not.toContain("Netflix");
    expect(names).not.toContain("Alquiler");
    expect(names).not.toContain("Gimnasio");
    expect(names).not.toContain("Visa Interbank (ciclo abierto)");
  });

  it("incluye compromisos vencidos e impagos", () => {
    const r = availableUntilPayday({
      ...base,
      fixedExpenses: [
        { name: "Luz", amount: { amountMinor: 12_000, currency: "PEN" }, dueDate: "2026-11-05", paid: false, paidWithCreditCard: false },
      ],
      cardPayments: [],
    });
    expect(r.byCurrency.PEN).toBe(215_000 - 12_000);
  });

  it("mantiene USD aparte y consolida con tipo de cambio", () => {
    const r = availableUntilPayday({
      ...base,
      cardPayments: [{ name: "Visa Interbank USD", amount: { amountMinor: 1_299, currency: "USD" }, dueDate: "2026-11-20" }],
    });
    expect(r.byCurrency).toEqual({ PEN: 215_000 - 8_990, USD: -1_299 });
    // 12.99 × 3.7520 = 48.7385 → 48.74
    expect(r.consolidated?.amountMinor).toBe(215_000 - 8_990 - 4_874);
  });

  it("sin tipo de cambio no inventa un consolidado", () => {
    const r = availableUntilPayday({
      ...base,
      fxToBase: {},
      cardPayments: [{ name: "USD", amount: { amountMinor: 1_000, currency: "USD" }, dueDate: "2026-11-20" }],
    });
    expect(r.consolidated).toBeNull();
    expect(r.perDayMinor).toBeNull();
  });

  it("puede quedar negativo", () => {
    const r = availableUntilPayday({ ...base, liquidBalances: [{ amountMinor: 10_000, currency: "PEN" }] });
    expect(r.byCurrency.PEN).toBe(10_000 - 8_990 - 81_680);
  });

  it("el día de pago: 0 días restantes, divide entre 1", () => {
    const r = availableUntilPayday({ ...base, today: "2026-11-27", fixedExpenses: [], cardPayments: [] });
    expect(r.daysUntilPayday).toBe(0);
    expect(r.perDayMinor).toBe(215_000);
  });
});
