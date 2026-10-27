import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { selectParser } from "../registry";
import type { ParserInput } from "../types";
import { interbankParser } from "./index";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const input = (rawText: string, sender = "Interbank <servicioalcliente@netinterbank.com.pe>"): ParserInput => ({
  source: "email",
  sender,
  rawText,
  receivedAt: new Date("2025-11-12T16:29:00Z"),
});

describe("interbankParser — correo real: Constancia de Pago Plin", () => {
  const raw = fixture("plin-a-yape.txt");

  it("lo selecciona el registro por el contenido", () => {
    expect(selectParser(input(raw, "alguien@gmail.com"))?.id).toBe("interbank-email");
  });

  it("extrae monto, cuenta, fecha y destino Yape (BCP)", () => {
    const r = interbankParser.parse(input(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.confidence).toBe(1);
    expect(r.movement).toMatchObject({
      kind: "transfer_out",
      amountMinor: 39_733,
      currency: "PEN",
      account: { bank: "interbank", last4: "1234", currency: "PEN" },
      counterparty: { label: "Yape", bank: "bcp", holder: "Juan P Perez M" },
      reference: "53271149",
      warnings: [],
    });
    // 11:28 AM en Lima = 16:28 UTC
    expect(r.movement.occurredAt.toISOString()).toBe("2025-11-12T16:28:00.000Z");
  });

  it("fecha con mediodía y mes abreviado: 08 Ago 2025 12:47 PM", () => {
    const r = interbankParser.parse(input(raw.replace("12 Nov 2025 11:28 AM", "08 Ago 2025 12:47 PM")));
    expect(r.ok && r.movement.occurredAt.toISOString()).toBe("2025-08-08T17:47:00.000Z");
  });

  it("otra constancia de Interbank sin ejemplo real → unrecognized (revisión)", () => {
    const r = interbankParser.parse(input("Constancia de Consumo Visa\nMoneda y monto: S/ 10.00"));
    expect(r).toMatchObject({ ok: false, reason: "unrecognized" });
  });

  it("correo publicitario → not_a_movement", () => {
    expect(interbankParser.parse(input("Descubre las ofertas de Interbank"))).toEqual({ ok: false, reason: "not_a_movement" });
  });
});
