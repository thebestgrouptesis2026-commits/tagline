import { bcpParser } from "./bcp";
import { interbankParser } from "./interbank";
import { manualParser } from "./manual";
import type { BankParser, ParseResult, ParserInput } from "./types";

/** Orden de evaluación: el primero cuyo `canParse` acepte gana. Añadir aquí un parser por banco/formato nuevo. */
const PARSERS: readonly BankParser[] = [manualParser, bcpParser, interbankParser];

export function selectParser(input: ParserInput): BankParser | null {
  return PARSERS.find((p) => p.canParse(input)) ?? null;
}

export function getParser(id: string): BankParser | null {
  return PARSERS.find((p) => p.id === id) ?? null;
}

/** Un parser que lanza no debe tumbar la ingesta: el evento queda para revisión. */
export function safeParse(parser: BankParser, input: ParserInput): ParseResult {
  try {
    return parser.parse(input);
  } catch (err) {
    return { ok: false, reason: "unrecognized", detail: `error del parser: ${(err as Error).message}` };
  }
}
