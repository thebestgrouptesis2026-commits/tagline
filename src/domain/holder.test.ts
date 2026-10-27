import { describe, expect, it } from "vitest";
import { isSameHolder } from "./holder";

describe("isSameHolder", () => {
  const full = "Juan Pablo Perez Mendoza";
  it("acepta iniciales y puntos", () => {
    expect(isSameHolder("Juan P Perez M.", full)).toBe(true);
    expect(isSameHolder("JUAN P PEREZ M", full)).toBe(true);
  });
  it("rechaza a otra persona o nombres demasiado cortos", () => {
    expect(isSameHolder("Maria Lopez", full)).toBe(false);
    expect(isSameHolder("Juan", full)).toBe(false);
    expect(isSameHolder("Juan Gomez", full)).toBe(false);
  });
  it("sin nombre guardado nunca asume que es uno mismo", () => {
    expect(isSameHolder("Juan P Perez M", null)).toBe(false);
  });
});
