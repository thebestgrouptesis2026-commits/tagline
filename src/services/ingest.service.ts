import { createHash } from "node:crypto";
import { getDb, type Tx } from "@/db/client";
import { categorize, normalizeMerchant } from "@/domain/categorize";
import { isSameHolder } from "@/domain/holder";
import { signedAmount, type TxnKind } from "@/domain/ledger";
import { formatMoney } from "@/domain/money";
import { matchesSalary } from "@/domain/payday";
import { HttpError } from "@/lib/http";
import { normalizeText } from "@/parsers/normalize";
import { safeParse, selectParser } from "@/parsers/registry";
import type { IngestSource, ParseResult, ParserInput } from "@/parsers/types";
import { findAccountByLast4, findAccountForHint, findCashAccount, findUniqueBankAccount, type AccountRow } from "@/repositories/accounts.repo";
import { findCategoryByName, listRules, recordRuleHit } from "@/repositories/categories.repo";
import { findDuplicate, insertEvent, updateEvent, type IngestEventRow } from "@/repositories/ingest-events.repo";
import { touchToken } from "@/repositories/tokens.repo";
import {
  getUserSettings,
  insertTransaction,
  linkTransfer,
  listActiveSalarySources,
} from "@/repositories/transactions.repo";

export interface IngestRequest {
  userId: string;
  tokenId: string;
  tokenScope: "ingest:all" | "ingest:manual";
  source: IngestSource;
  sender: string;
  rawText: string;
  receivedAt: Date;
  idempotencyKey: string | null;
}

export interface IngestResponse {
  httpStatus: 200 | 201 | 202;
  body: {
    status: "recorded" | "needs_review" | "duplicate" | "ignored";
    event_id: string;
    transaction_id?: string;
    message: string;
    confidence?: number;
  };
}

interface Recorded {
  eventStatus: "parsed" | "needs_review" | "ignored";
  status: "recorded" | "needs_review" | "ignored";
  message: string;
  transactionId?: string;
  confidence?: number;
  parsed?: unknown;
  error?: string;
}

const DEFAULT_REVIEW_THRESHOLD = 0.8;

/**
 * Huella del mensaje: texto normalizado + remitente + instante de recepción redondeado.
 * Correo/SMS: al minuto (reenvíos del mismo mensaje). Manual: al segundo, para que dos
 * cafés de S/ 5 seguidos no se fusionen pero un doble toque sí se descarte.
 */
export function contentHash(source: IngestSource, rawText: string, sender: string, receivedAt: Date): string {
  const bucketMs = source === "manual" ? 1_000 : 60_000;
  const bucket = new Date(Math.floor(receivedAt.getTime() / bucketMs) * bucketMs).toISOString();
  return createHash("sha256")
    .update([source, normalizeText(rawText), sender.trim().toLowerCase(), bucket].join("\u0000"))
    .digest("hex");
}

function duplicateResponse(dup: IngestEventRow, hash: string, idempotencyKey: string | null): IngestResponse {
  if (idempotencyKey && dup.idempotencyKey === idempotencyKey && dup.contentHash !== hash) {
    throw new HttpError(409, "idempotency_conflict", "Idempotency-Key ya usada con otro contenido");
  }
  return {
    httpStatus: 200,
    body: { status: "duplicate", event_id: dup.id, message: `Ya registrado: ${dup.replyText ?? "mensaje previo"}` },
  };
}

export async function ingest(req: IngestRequest): Promise<IngestResponse> {
  if (req.tokenScope === "ingest:manual" && req.source !== "manual") {
    throw new HttpError(403, "forbidden_scope", "Este token solo puede registrar movimientos manuales");
  }

  const db = getDb();
  const hash = contentHash(req.source, req.rawText, req.sender, req.receivedAt);
  const dup = await findDuplicate(db, req.userId, hash, req.idempotencyKey);
  if (dup) return duplicateResponse(dup, hash, req.idempotencyKey);

  const input: ParserInput = { source: req.source, sender: req.sender, rawText: req.rawText, receivedAt: req.receivedAt };
  const parser = selectParser(input);
  const result: ParseResult = parser
    ? safeParse(parser, input)
    : { ok: false, reason: "unrecognized", detail: "ningún parser reconoce este remitente" };

  const outcome = await db.transaction(async (tx) => {
    const event = await insertEvent(tx, req.userId, {
      tokenId: req.tokenId,
      source: req.source,
      sender: req.sender,
      rawText: req.rawText,
      receivedAt: req.receivedAt,
      contentHash: hash,
      idempotencyKey: req.idempotencyKey,
      parserId: parser?.id ?? null,
      parserVersion: parser?.version ?? null,
    });
    if (!event) return null; // otra petición concurrente ganó la carrera

    const rec = await record(tx, req, event.id, result);
    await updateEvent(tx, req.userId, event.id, {
      status: rec.eventStatus,
      confidence: rec.confidence ?? null,
      parsed: rec.parsed ?? null,
      error: rec.error ?? null,
      replyText: rec.message,
    });
    await touchToken(tx, req.userId, req.tokenId);
    return { eventId: event.id, ...rec };
  });

  if (!outcome) {
    const winner = await findDuplicate(db, req.userId, hash, req.idempotencyKey);
    if (!winner) throw new Error("Conflicto de ingesta sin evento existente");
    return duplicateResponse(winner, hash, req.idempotencyKey);
  }

  return {
    httpStatus: outcome.status === "recorded" ? 201 : outcome.status === "needs_review" ? 202 : 200,
    body: {
      status: outcome.status,
      event_id: outcome.eventId,
      transaction_id: outcome.transactionId,
      message: outcome.message,
      confidence: outcome.confidence,
    },
  };
}

/** Del resultado del parser a filas en `transactions` (y `transfers` si es entre cuentas propias). */
async function record(tx: Tx, req: IngestRequest, eventId: string, result: ParseResult): Promise<Recorded> {
  if (!result.ok) {
    if (result.reason === "not_a_movement") return { eventStatus: "ignored", status: "ignored", message: "Correo sin movimiento" };
    return { eventStatus: "needs_review", status: "needs_review", message: "Revisar: no se pudo leer el mensaje", error: result.detail };
  }

  const mv = result.movement;
  let confidence = result.confidence;
  const amountText = formatMoney({ amountMinor: mv.amountMinor, currency: mv.currency });
  const review = (message: string): Recorded => ({
    eventStatus: "needs_review",
    status: "needs_review",
    message: `Revisar: ${message}`,
    confidence,
    parsed: mv,
  });

  const resolved = await findAccountForHint(tx, req.userId, mv.account);
  if (!resolved) return review(`${amountText} sin cuenta identificada`);
  // El banco convirtió la moneda (ej. compra en USD con débito en soles): sin el monto
  // convertido no podemos registrar en la cuenta sin romper "una cuenta = una moneda".
  if (resolved.currencyMismatch) return review(`${amountText} en moneda distinta a ${resolved.account.name}`);
  const account = resolved.account;

  let kind: TxnKind = mv.kind;
  let incomeSourceId: string | null = null;
  let categoryId: string | null = null;
  let categoryName: string | null = null;

  if (kind === "deposit" || kind === "transfer_in" || kind === "salary") {
    const sources = await listActiveSalarySources(tx, req.userId);
    const hit = sources.find((s) =>
      matchesSalary(
        { amountMinor: mv.amountMinor, currency: mv.currency, accountId: account.id, text: req.rawText },
        s,
      ),
    );
    if (hit) {
      kind = "salary";
      incomeSourceId = hit.id;
      categoryId = hit.categoryId;
    }
  }

  // ¿La otra cuenta también es mía? Entonces es un movimiento interno, no gasto ni ingreso.
  let counter: AccountRow | null = null;
  if (mv.counterparty?.last4) counter = await findAccountByLast4(tx, req.userId, mv.counterparty.last4, mv.currency);
  if (!counter && kind === "cash_withdrawal") counter = await findCashAccount(tx, req.userId, mv.currency);
  if (counter?.id === account.id) counter = null;
  // Transferencia a uno mismo (mismo titular, ej. Plin Interbank → Yape): es movimiento interno.
  // Si no sabemos cuál es la cuenta destino, se pide elegirla en vez de contarla como gasto.
  const settings = await getUserSettings(tx, req.userId);
  if (!counter && kind === "transfer_out" && isSameHolder(mv.counterparty?.holder, settings?.name)) {
    counter = mv.counterparty?.bank ? await findUniqueBankAccount(tx, req.userId, mv.counterparty.bank, mv.currency, account.id) : null;
    if (!counter) return review(`${amountText} a ti mismo: elige la cuenta destino`);
  }
  if (counter?.type === "credit_card" && kind === "transfer_out") kind = "card_payment";

  const merchantNormalized = mv.merchant ? normalizeMerchant(mv.merchant) : null;
  if (!counter && !categoryId) {
    const isIncome = signedAmount(kind, 1) > 0;
    if (mv.categoryHint) {
      const c = await findCategoryByName(tx, req.userId, mv.categoryHint, isIncome ? "income" : "expense");
      categoryId = c?.id ?? null;
      categoryName = c?.name ?? null;
    }
    if (!categoryId) {
      const hit = categorize(merchantNormalized ?? (mv.categoryHint ? normalizeMerchant(mv.categoryHint) : null), await listRules(tx, req.userId));
      if (hit) {
        categoryId = hit.categoryId;
        await recordRuleHit(tx, req.userId, hit.ruleId);
      }
    }
  }

  const posted = confidence >= (settings?.reviewThreshold ?? DEFAULT_REVIEW_THRESHOLD);
  const status = posted ? "posted" : "pending_review";
  const amountMinor = signedAmount(kind, mv.amountMinor);

  const main = await insertTransaction(tx, req.userId, {
    accountId: account.id,
    kind,
    status,
    source: req.source,
    amountMinor,
    currency: mv.currency,
    occurredAt: mv.occurredAt,
    merchant: mv.merchant,
    merchantNormalized,
    description: mv.reference ? `Op. ${mv.reference}` : null,
    categoryId,
    incomeSourceId,
    ingestEventId: eventId,
    confidence,
  });

  if (counter) {
    const mirrorKind: TxnKind = kind === "transfer_out" ? "transfer_in" : kind === "transfer_in" ? "transfer_out" : kind;
    const mirror = await insertTransaction(tx, req.userId, {
      accountId: counter.id,
      kind: mirrorKind,
      status,
      source: req.source,
      amountMinor: -amountMinor,
      currency: mv.currency,
      occurredAt: mv.occurredAt,
      merchant: account.name,
      merchantNormalized: normalizeMerchant(account.name),
      ingestEventId: eventId,
      confidence,
    });
    const [from, to] = amountMinor < 0 ? [main.id, mirror.id] : [mirror.id, main.id];
    await linkTransfer(tx, req.userId, from, to);
  }

  const message = describe({ kind, amountText, account, counter, merchant: mv.merchant, categoryName, cash: mv.account.type === "cash" });
  return {
    eventStatus: posted ? "parsed" : "needs_review",
    status: posted ? "recorded" : "needs_review",
    message: posted ? message : `Revisar: ${message}`,
    transactionId: main.id,
    confidence,
    parsed: mv,
  };
}

function describe(p: {
  kind: TxnKind;
  amountText: string;
  account: AccountRow;
  counter: AccountRow | null;
  merchant: string | null;
  categoryName: string | null;
  cash: boolean;
}): string {
  const { kind, amountText, account, counter } = p;
  if (kind === "salary") return `Sueldo recibido: ${amountText} → ${account.name}`;
  if (counter && kind === "card_payment") return `Pago de tarjeta: ${amountText} ${account.name} → ${counter.name}`;
  if (counter && kind === "cash_withdrawal") return `Retiro: ${amountText} ${account.name} → ${counter.name}`;
  if (counter) return `Transferencia: ${amountText} ${account.name} → ${counter.name}`;
  const incoming = signedAmount(kind, 1) > 0;
  if (p.cash) return incoming ? `Ingreso en efectivo: ${amountText}` : `Efectivo: ${amountText} en ${p.categoryName ?? "Sin categoría"}`;
  if (incoming) return `Ingreso: ${amountText} → ${account.name}`;
  return `${amountText} en ${p.merchant ?? p.categoryName ?? "gasto"} → ${account.name}`;
}
