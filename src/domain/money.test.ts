import { describe, expect, it } from "vitest";
import { consolidate, convertMinor, formatMoney, parseAmountToMinor } from "./money";

describe("parseAmountToMinor", () => {
  it.each([
    ["1,320.00", 132_000],
    ["1320", 132_000],
    ["45.9", 4_590],
    ["12,50", 1_250],
    ["1,234,567.89", 123_456_789],
    ["0.05", 5],
  ])("%s → %d", (input, expected) => {
    expect(parseAmountToMinor(input)).toBe(expected);
  });

  it.each(["", "abc", "1.234", "12.345,00", "1,23,4", "-5"])("rechaza %s", (input) => {
    expect(parseAmountToMinor(input)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formato es-PE", () => {
    expect(formatMoney({ amountMinor: 132_000, currency: "PEN" })).toBe("S/ 1,320.00");
    expect(formatMoney({ amountMinor: -1_299, currency: "USD" })).toBe("-US$ 12.99");
    expect(formatMoney({ amountMinor: 5, currency: "PEN" }, { sign: true })).toBe("+S/ 0.05");
  });
});

describe("convertMinor / consolidate", () => {
  it("redondea half-up con enteros", () => {
    expect(convertMinor(1_299, "3.7520")).toBe(4_874);
    expect(convertMinor(-1_299, "3.7520")).toBe(-4_874);
    expect(convertMinor(1, "3.5")).toBe(4); // 3.5 → 4
  });

  it("consolida solo si hay tipo de cambio para todo", () => {
    expect(consolidate({ PEN: 1_000, USD: 100 }, "PEN", { USD: "3.75" })).toBe(1_375);
    expect(consolidate({ PEN: 1_000, USD: 100 }, "PEN", {})).toBeNull();
    expect(consolidate({ PEN: 1_000, USD: 0 }, "PEN", {})).toBe(1_000);
  });
});
