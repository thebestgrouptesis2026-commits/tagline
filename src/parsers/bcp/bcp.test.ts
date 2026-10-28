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

const notif = (rawText: string): ParserInput => ({
  ...input(rawText),
  sender: "BCP Notificaciones <notificaciones@notificacionesbcp.com.pe>",
  receivedAt: new Date("2026-10-26T16:13:00Z"),
});

describe("bcpParser — notificaciones reales (notificacionesbcp.com.pe)", () => {
  it("lo selecciona el registro por el remitente de notificaciones", () => {
    expect(selectParser(notif("x"))?.id).toBe("bcp-email");
  });

  it("consumo con tarjeta de débito", () => {
    const r = bcpParser.parse(notif(fixture("notificacion-consumo-debito.txt")));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.confidence).toBe(1);
    expect(r.movement).toMatchObject({
      kind: "purchase",
      amountMinor: 8_831,
      currency: "PEN",
      merchant: "ANTHROPIC* CLAUDE SUB",
      account: { bank: "bcp", last4: "4567", currency: "PEN" },
      counterparty: null,
      reference: "391799",
      warnings: [],
    });
    // 11:12 AM en Lima = 16:12 UTC
    expect(r.movement.occurredAt.toISOString()).toBe("2026-10-26T16:12:00.000Z");
  });

  it("yapeo a celular (propio): transferencia saliente sin últimos 4, cuenta por banco+moneda", () => {
    const r = bcpParser.parse(notif(fixture("notificacion-yapeo.txt")));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.confidence).toBe(1);
    expect(r.movement).toMatchObject({
      kind: "transfer_out",
      amountMinor: 1_000,
      account: { bank: "bcp", last4: null, currency: "PEN" },
      counterparty: { label: "Yape", holder: "Juan P Perez M" },
      warnings: [],
    });
    // 01:02 PM en Lima = 18:02 UTC
    expect(r.movement.occurredAt.toISOString()).toBe("2026-10-26T18:02:00.000Z");
  });

  it("tolera etiqueta y valor en la misma línea o en líneas separadas", () => {
    const flat = fixture("notificacion-consumo-debito.txt").replace(/\n\n(?=[^\n])/g, "\n").replace(/^(Total del consumo|Operación realizada|Fecha y hora|Número de Tarjeta de Débito|Empresa|Número de operación)\n/gm, "$1   ");
    const r = bcpParser.parse(notif(flat));
    expect(r.ok && r.movement.amountMinor).toBe(8_831);
    expect(r.ok && r.movement.account.last4).toBe("4567");
  });

  it("yapeo recibido: ingreso con quién lo envió (titular para detectar si eres tú)", () => {
    const r = bcpParser.parse(notif(fixture("notificacion-yapeo-recibido.txt")));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.confidence).toBe(1);
    expect(r.movement).toMatchObject({
      kind: "transfer_in",
      amountMinor: 100,
      currency: "PEN",
      merchant: "Perez Lopez Juan Pablo",
      account: { bank: "bcp", last4: null, currency: "PEN" },
      counterparty: { label: "Yape", holder: "Perez Lopez Juan Pablo" },
      warnings: [],
    });
    // 10:37 PM en Lima = 03:37 UTC del día siguiente
    expect(r.movement.occurredAt.toISOString()).toBe("2026-10-28T03:37:00.000Z");
  });

  it("yapeo recibido con la tabla aplanada en una línea por fila", () => {
    const flat = fixture("notificacion-yapeo-recibido.txt").replace(/^(Monto recibido|Operación realizada|Fecha y hora|Enviado por)\n/gm, "$1   ");
    const r = bcpParser.parse(notif(flat));
    expect(r.ok && r.movement.amountMinor).toBe(100);
    expect(r.ok && r.movement.counterparty?.holder).toBe("Perez Lopez Juan Pablo");
  });

  it("yapeo recibido sin tabla: el remitente sale del titular", () => {
    const r = bcpParser.parse(notif("Recibiste un yapeo de S/ 25.00 de Maria Lopez.\nFecha y hora\n26 de octubre de 2026 - 01:02 PM"));
    expect(r.ok && r.movement.counterparty?.holder).toBe("Maria Lopez");
  });
});

describe("bcpParser — texto real de Gmail getPlainBody() (negritas con *, tabla aplanada)", () => {
  it("transferencia a terceros: monto, fecha, cuenta origen y destino por últimos 4", () => {
    const r = bcpParser.parse(notif(fixture("gmail-transferencia-terceros.txt")));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.confidence).toBe(1);
    expect(r.movement).toMatchObject({
      kind: "transfer_out",
      amountMinor: 200_000,
      currency: "PEN",
      merchant: "Lopez Rojas Maria E",
      account: { bank: "bcp", last4: "1072", currency: "PEN" },
      counterparty: { last4: "9021", holder: "Lopez Rojas Maria E" },
      reference: "06080198",
      warnings: [],
    });
    // 08:38 PM en Lima = 01:38 UTC del día siguiente
    expect(r.movement.occurredAt.toISOString()).toBe("2026-10-25T01:38:00.000Z");
  });

  it("yapeo enviado: cuenta de origen por 'Desde … **** 1046'; el celular no cuenta como últimos 4", () => {
    const r = bcpParser.parse(notif(fixture("gmail-yapeo-enviado.txt")));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.movement).toMatchObject({
      kind: "transfer_out",
      amountMinor: 1_500,
      account: { bank: "bcp", last4: "1046", currency: "PEN" },
      counterparty: { last4: null, label: "Yape", bank: "bcp", holder: "Juan P Perez M" },
      reference: "05078308",
    });
    expect(r.movement.occurredAt.toISOString()).toBe("2026-10-24T23:25:00.000Z");
  });

  it("transferencia entre mis cuentas: destino por últimos 4, sin titular", () => {
    const raw = fixture("gmail-transferencia-terceros.txt")
      .replace("Transferencia a terceros BCP", "Transferencia entre mis cuentas")
      .replace("Enviado a *Lopez Rojas Maria E.*", "Enviado a **")
      .replace("**** 1072 Enviado a **", "**** 1072 Enviado a *Clasica*");
    const r = bcpParser.parse(notif(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.movement).toMatchObject({
      kind: "transfer_out",
      account: { last4: "1072" },
      counterparty: { last4: "9021", label: "Entre mis cuentas", holder: null },
    });
  });

  it("yapeo recibido con negritas de Gmail", () => {
    const raw = fixture("notificacion-yapeo-recibido.txt").replace("yapeo de S/ 1.00", "*yapeo de S/ 1.00*").replace(/^S\/ 1\.00$/m, "*S/ 1.00*");
    const r = bcpParser.parse(notif(raw));
    expect(r.ok && r.movement.amountMinor).toBe(100);
    expect(r.ok && r.movement.kind).toBe("transfer_in");
  });

  it("notificación con monto pero formato desconocido → revisión, no se ignora", () => {
    const r = bcpParser.parse(notif("Hola,\nRealizaste un pago de servicio de *S/ 45.00* con tu cuenta."));
    expect(r).toMatchObject({ ok: false, reason: "unrecognized" });
  });

  it("aviso sin monto (configuración de tarjeta) → not_a_movement", () => {
    const r = bcpParser.parse(notif("Realizaste una configuración para tu Tarjeta de Débito ."));
    expect(r).toEqual({ ok: false, reason: "not_a_movement" });
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
