import { describe, expect, it } from "vitest";
import { manualKinds } from "./manual-entry";

describe("manualKinds", () => {
  it("gasto e ingreso no llevan pata espejo", () => {
    expect(manualKinds("gasto", "checking", null)).toEqual({ kind: "purchase", mirrorKind: null });
    expect(manualKinds("ingreso", "checking", null)).toEqual({ kind: "income_other", mirrorKind: null });
  });

  it("a una tarjeta de crédito es pago de tarjeta", () => {
    expect(manualKinds("transferencia", "checking", "credit_card").kind).toBe("card_payment");
  });

  it("del banco al efectivo es retiro; entre efectivos es transferencia", () => {
    expect(manualKinds("transferencia", "checking", "cash").kind).toBe("cash_withdrawal");
    expect(manualKinds("transferencia", "cash", "cash")).toEqual({ kind: "transfer_out", mirrorKind: "transfer_in" });
  });

  it("transferencia sin destino es un error", () => {
    expect(() => manualKinds("transferencia", "checking", null)).toThrow();
  });
});
