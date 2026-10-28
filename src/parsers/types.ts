import type { TxnKind } from "@/domain/ledger";
import type { Currency } from "@/domain/money";

export type IngestSource = "sms" | "email" | "manual";

export interface ParserInput {
  source: IngestSource;
  sender: string;
  rawText: string;
  receivedAt: Date;
}

/** Pista para encontrar la cuenta propia afectada. */
export interface AccountHint {
  bank: string | null;
  last4: string | null;
  /** "wallet": billetera del banco (Yape es la cuenta billetera de BCP). */
  type: "cash" | "wallet" | null;
  currency: Currency;
}

export interface ParsedMovement {
  kind: TxnKind;
  /** Magnitud positiva; el signo lo decide el tipo (`signedAmount`). */
  amountMinor: number;
  currency: Currency;
  occurredAt: Date;
  merchant: string | null;
  account: AccountHint;
  /** Otra cuenta involucrada (destino de una transferencia, tarjeta pagada). */
  counterparty: {
    last4: string | null;
    label: string;
    /** Banco de la otra cuenta si el mensaje lo dice (ej. destino "Yape" ⇒ "bcp"). */
    bank?: string | null;
    /** Titular de la otra cuenta, para reconocer transferencias a uno mismo. */
    holder?: string | null;
  } | null;
  /** Texto libre que el usuario escribió como categoría (entrada manual). */
  categoryHint: string | null;
  reference: string | null;
  /** Palabras relevantes detectadas (ej. "PLANILLA") para conciliar el sueldo. */
  keywords: string[];
  warnings: string[];
}

export type ParseResult =
  | { ok: true; movement: ParsedMovement; confidence: number }
  | { ok: false; reason: "not_a_movement" | "unrecognized"; detail?: string };

export interface BankParser {
  readonly id: string;
  /** Subir al cambiar la lógica: los eventos guardan qué versión los procesó. */
  readonly version: number;
  canParse(input: ParserInput): boolean;
  parse(input: ParserInput): ParseResult;
}

export function clampConfidence(c: number): number {
  return Math.round(Math.min(Math.max(c, 0), 1) * 100) / 100;
}
