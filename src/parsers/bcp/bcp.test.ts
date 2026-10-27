import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { selectParser } from "../registry";
import type { ParserInput } from "../types";
import { bcpParser } from "./index";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

const input = (rawText: string): ParserInput => ({
  source: "email",
  sender: "BCP Comunica <bcpcomunica@email.bcp.com.pe>",
  rawText,
  receivedAt: new Date("2026-10-27T19:05:00Z"),
});

describe("bcpParser — correo real: transferencia a terceros", () => {
  const result = bcpParser.parse(input(fixture("transferencia-terceros.txt")));

  it("lo selecciona el registro por remitente", () => {
    expect(selectParser(input("x"))?.id).toBe("bcp-email");
  });

  it("extrae todos los campos con confianza alta", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(1);
    expect(result.movement).toMatchObject({
      kind: "transfer_out",
      amountMinor: 15_000,
      currency: "PEN",
      merchant: "MARIA LOPEZ",
      account: { bank: "bcp", last4: "1234", currency: "PEN" },
      counterparty: { last4: "9876" },
      reference: "123456",
      warnings: [],
    });
    // 14:03 en Lima = 19:03 UTC
    expect(result.movement.occurredAt.toISOString()).toBe("2026-10-27T19:03:00.000Z");
  });
});

describe("bcpParser — formatos SINTÉTICOS (pendientes de correo real)", () => {
  it("abono de planilla: detecta sueldo, pero va a revisión por formato no verificado", () => {
    const r = bcpParser.parse(input(fixture("deposito-planilla.synthetic.txt")));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.movement).toMatchObject({
      kind: "salary",
      amountMinor: 132_000,
      account: { last4: "1234" },
      merchant: "EMPRESA EJEMPLO SAC",
      keywords: ["PLANILLA"],
    });
    expect(r.confidence).toBeLessThan(0.8);
  });

  it("compra con débito: comercio y tarjeta", () => {
    const r = bcpParser.parse(input(fixture("compra-debito.synthetic.txt")));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.movement).toMatchObject({
      kind: "purchase",
      amountMinor: 4_590,
      merchant: "PLAZA VEA SAN ISIDRO",
      account: { last4: "1234" },
    });
    expect(r.movement.warnings).toContain("formato_no_verificado");
  });
});

describe("bcpParser — casos borde", () => {
  it("correo publicitario sin operación ni monto → not_a_movement", () => {
    const r = bcpParser.parse(input("¡Aprovecha tu préstamo preaprobado! Banco de Crédito BCP"));
    expect(r).toEqual({ ok: false, reason: "not_a_movement" });
  });

  it("operación desconocida → unrecognized (va a revisión, no se pierde)", () => {
    const r = bcpParser.parse(input("Operación: Algo Nuevo\nMonto: S/ 10.00"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unrecognized");
  });

  it("sin cuenta identificable baja la confianza bajo el umbral", () => {
    const r = bcpParser.parse(input("Operación: Transferencia a Terceros\nFecha y Hora: 27/10/2026 - 14:03 h.\nMonto: S/ 10.00"));
    expect(r.ok && r.confidence).toBe(0.7);
  });

  it("tolera CRLF y espacios no separables", () => {
    const raw = fixture("transferencia-terceros.txt").replace(/\n/g, "\r\n").replace(/ {2,}/g, "  ");
    const r = bcpParser.parse(input(raw));
    expect(r.ok && r.movement.amountMinor).toBe(15_000);
  });
});
