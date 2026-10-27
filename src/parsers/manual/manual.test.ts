import { describe, expect, it } from "vitest";
import { manualParser } from "./index";

const parse = (rawText: string) =>
  manualParser.parse({ source: "manual", sender: "atajo", rawText, receivedAt: new Date("2026-10-27T15:00:00Z") });

describe("manualParser", () => {
  it.each([
    ["12.50 comida", 1_250, "PEN", "comida"],
    ["S/ 8 taxi", 800, "PEN", "taxi"],
    ["12,5 menu", 1_250, "PEN", "menu"],
    ["$5 cafe", 500, "USD", "cafe"],
    ["20", 2_000, "PEN", null],
  ] as const)("%s", (raw, amount, currency, category) => {
    const r = parse(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.movement).toMatchObject({
      kind: "purchase",
      amountMinor: amount,
      currency,
      categoryHint: category,
      account: { type: "cash", currency },
    });
  });

  it("'+' registra un ingreso en efectivo", () => {
    const r = parse("+80 venta");
    expect(r.ok && r.movement.kind).toBe("income_other");
  });

  it.each(["", "comida", "0", "-5 taxi"])("rechaza %j", (raw) => {
    expect(parse(raw).ok).toBe(false);
  });
});
