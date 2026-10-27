/**
 * Ciclo — esquema de base de datos (Drizzle ORM, PostgreSQL/Neon).
 *
 * Convenciones:
 * - Dinero: `*_minor` = entero en la unidad mínima (céntimos) + `currency` ISO 4217. Nunca float.
 * - Fechas-hora: `timestamptz` en UTC. Fechas de calendario (corte, pago, feriados): `date` en hora de Lima.
 * - Toda tabla de dominio lleva `user_id` y borrado lógico `deleted_at`.
 * - `transactions.amount_minor` tiene signo relativo a la cuenta: < 0 sale dinero, > 0 entra.
 */
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { TXN_KINDS } from "../domain/ledger";
import { CURRENCIES } from "../domain/money";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const currency = pgEnum("currency", CURRENCIES);

export const accountType = pgEnum("account_type", [
  "checking", // cuenta sueldo / corriente
  "savings",
  "cash",
  "wallet", // billetera digital (Yape, Plin)
  "debit_card", // vinculada a una cuenta (parent_account_id)
  "credit_card", // una por moneda, vinculada a credit_cards
]);

export const cardNetwork = pgEnum("card_network", ["visa", "mastercard", "amex", "diners"]);

export const txnKind = pgEnum("txn_kind", TXN_KINDS);

export const txnStatus = pgEnum("txn_status", ["posted", "pending_review", "voided"]);

export const txnSource = pgEnum("txn_source", ["sms", "email", "manual", "recurring", "import"]);

export const ingestStatus = pgEnum("ingest_status", [
  "received",
  "parsed",
  "needs_review",
  "duplicate",
  "ignored", // correo publicitario u otro sin movimiento
  "failed",
]);

export const frequency = pgEnum("frequency", ["weekly", "biweekly", "semimonthly", "monthly", "yearly"]);

/** Qué hacer si una fecha esperada cae en día no hábil. */
export const businessDayAdjust = pgEnum("business_day_adjust", ["none", "previous", "next"]);

export const categoryKind = pgEnum("category_kind", ["expense", "income"]);

export const ruleMatch = pgEnum("rule_match", ["contains", "equals", "starts_with", "regex"]);

export const installmentStatus = pgEnum("installment_status", ["active", "paid", "cancelled"]);

export const alertType = pgEnum("alert_type", [
  "card_payment_due",
  "fixed_expense_due",
  "salary_missing",
  "budget_near",
  "budget_exceeded",
  "credit_usage_high",
  "unusual_spend",
  "recurring_amount_changed",
  "recurring_detected",
  "parser_failed",
]);

export const alertSeverity = pgEnum("alert_severity", ["info", "warning", "urgent"]);

export const tokenScope = pgEnum("token_scope", ["ingest:all", "ingest:manual"]);

export const fxSource = pgEnum("fx_source", ["manual", "api"]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const id = () => uuid("id").primaryKey().defaultRandom();
const money = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const deletedAt = () => timestamp("deleted_at", { withTimezone: true });
const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

// ─── Usuarios y auth (Auth.js Drizzle adapter, tablas renombradas) ────────────

export const users = pgTable("users", {
  id: id(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  timezone: text("timezone").notNull().default("America/Lima"),
  baseCurrency: currency("base_currency").notNull().default("PEN"),
  /** Umbral de confianza bajo el cual un movimiento va a revisión. */
  reviewThreshold: real("review_threshold").notNull().default(0.8),
  telegramChatId: text("telegram_chat_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authAccounts = pgTable(
  "auth_accounts",
  {
    userId: userId(),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const authSessions = pgTable("auth_sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: userId(),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/** Passkeys (WebAuthn). */
export const authenticators = pgTable(
  "authenticators",
  {
    credentialID: text("credential_id").notNull().unique(),
    userId: userId(),
    providerAccountId: text("provider_account_id").notNull(),
    credentialPublicKey: text("credential_public_key").notNull(),
    counter: integer("counter").notNull(),
    credentialDeviceType: text("credential_device_type").notNull(),
    credentialBackedUp: boolean("credential_backed_up").notNull(),
    transports: text("transports"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.credentialID] })],
);

// ─── Tokens de dispositivo (webhook) ─────────────────────────────────────────

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(), // "iPhone Atajos", "Gmail Apps Script"
    /** Prefijo visible para identificarlo en la UI (ej. "ck_live_a1b2"). */
    prefix: text("prefix").notNull(),
    /** SHA-256 hex del token completo. El token en claro se muestra una sola vez. */
    tokenHash: text("token_hash").notNull().unique(),
    scope: tokenScope("scope").notNull().default("ingest:all"),
    /** Secreto HMAC opcional (cifrado con APP_ENCRYPTION_KEY) para clientes que puedan firmar. */
    hmacSecretEnc: text("hmac_secret_enc"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId)],
);

// ─── Cuentas y tarjetas ──────────────────────────────────────────────────────

export const creditCards = pgTable(
  "credit_cards",
  {
    id: id(),
    userId: userId(),
    bank: text("bank").notNull(), // "interbank"
    name: text("name").notNull(), // "Visa Clásica"
    network: cardNetwork("network").notNull(),
    last4: text("last4").notNull(),
    /** Línea total, compartida entre monedas, expresada en `limitCurrency`. */
    limitMinor: money("limit_minor").notNull(),
    limitCurrency: currency("limit_currency").notNull().default("PEN"),
    closingDay: smallint("closing_day").notNull(), // 26
    dueDay: smallint("due_day").notNull(), // 20 (del mes siguiente al corte)
    dueAdjust: businessDayAdjust("due_adjust").notNull().default("previous"),
    closingAdjust: businessDayAdjust("closing_adjust").notNull().default("none"),
    /** TEA por defecto para cuotas, en fracción (0.6599 = 65.99%). */
    defaultInstallmentTea: numeric("default_installment_tea", { precision: 7, scale: 4 }),
    usageAlertPct: smallint("usage_alert_pct").notNull().default(70),
    color: text("color").notNull().default("#af50ff"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("credit_cards_user_idx").on(t.userId),
    check("credit_cards_last4_chk", sql`${t.last4} ~ '^[0-9]{4}$'`),
    check("credit_cards_closing_chk", sql`${t.closingDay} between 1 and 31`),
    check("credit_cards_due_chk", sql`${t.dueDay} between 1 and 31`),
    check("credit_cards_limit_chk", sql`${t.limitMinor} >= 0`),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: userId(),
    type: accountType("type").notNull(),
    name: text("name").notNull(), // "BCP Sueldo", "Efectivo", "Interbank Visa (USD)"
    bank: text("bank"), // "bcp" | "interbank" | null (efectivo)
    currency: currency("currency").notNull(),
    last4: text("last4"),
    /** Débito → cuenta a la que está vinculada. */
    parentAccountId: uuid("parent_account_id"),
    /** credit_card → tarjeta a la que pertenece esta moneda. */
    creditCardId: uuid("credit_card_id").references(() => creditCards.id),
    /** Saldo de apertura; el saldo actual = opening + sum(transactions posted). */
    openingBalanceMinor: money("opening_balance_minor").notNull().default(0),
    openingBalanceAt: timestamp("opening_balance_at", { withTimezone: true }).notNull().defaultNow(),
    color: text("color").notNull().default("#828384"),
    includeInNetWorth: boolean("include_in_net_worth").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("accounts_user_idx").on(t.userId),
    // Resolver la cuenta desde un correo: banco + últimos 4 + moneda.
    index("accounts_lookup_idx").on(t.userId, t.bank, t.last4),
    uniqueIndex("accounts_card_currency_uq")
      .on(t.creditCardId, t.currency)
      .where(sql`${t.creditCardId} is not null and ${t.deletedAt} is null`),
    check("accounts_last4_chk", sql`${t.last4} is null or ${t.last4} ~ '^[0-9]{4}$'`),
    check(
      "accounts_card_link_chk",
      sql`(${t.type} = 'credit_card') = (${t.creditCardId} is not null)`,
    ),
  ],
);

/**
 * Estado de cuenta real. Las fechas del ciclo se CALCULAN (lib/domain/billing-cycle);
 * aquí se guardan los montos que informa el banco cuando están disponibles.
 */
export const cardStatements = pgTable(
  "card_statements",
  {
    id: id(),
    userId: userId(),
    creditCardId: uuid("credit_card_id")
      .notNull()
      .references(() => creditCards.id),
    currency: currency("currency").notNull(),
    periodStart: date("period_start").notNull(),
    closingDate: date("closing_date").notNull(),
    dueDate: date("due_date").notNull(),
    totalDueMinor: money("total_due_minor"),
    minimumDueMinor: money("minimum_due_minor"),
    paidMinor: money("paid_minor").notNull().default(0),
    source: txnSource("source").notNull().default("manual"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("card_statements_uq").on(t.creditCardId, t.currency, t.closingDate)],
);

export const installmentPlans = pgTable(
  "installment_plans",
  {
    id: id(),
    userId: userId(),
    creditCardId: uuid("credit_card_id")
      .notNull()
      .references(() => creditCards.id),
    /** Compra original. */
    transactionId: uuid("transaction_id").notNull(),
    currency: currency("currency").notNull(),
    principalMinor: money("principal_minor").notNull(),
    count: smallint("count").notNull(),
    /** TEA en fracción; null o 0 = sin intereses. */
    tea: numeric("tea", { precision: 7, scale: 4 }),
    firstDueCycleClosing: date("first_due_cycle_closing").notNull(),
    status: installmentStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("installment_plans_card_idx").on(t.creditCardId, t.status),
    check("installment_plans_count_chk", sql`${t.count} between 2 and 60`),
    check("installment_plans_principal_chk", sql`${t.principalMinor} > 0`),
  ],
);

export const installments = pgTable(
  "installments",
  {
    id: id(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => installmentPlans.id, { onDelete: "cascade" }),
    number: smallint("number").notNull(), // 1..count
    cycleClosing: date("cycle_closing").notNull(),
    amountMinorEstimated: money("amount_minor_estimated").notNull(),
    /** Monto real informado por el banco; prevalece sobre el estimado. */
    amountMinorActual: money("amount_minor_actual"),
    principalMinor: money("principal_minor").notNull(),
    interestMinor: money("interest_minor").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("installments_plan_number_uq").on(t.planId, t.number),
    index("installments_cycle_idx").on(t.cycleClosing),
  ],
);

// ─── Categorías y reglas ─────────────────────────────────────────────────────

export const categories = pgTable(
  "categories",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    kind: categoryKind("kind").notNull(),
    icon: text("icon"),
    color: text("color"),
    parentId: uuid("parent_id"),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("categories_user_name_uq")
      .on(t.userId, t.kind, t.name)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const categorizationRules = pgTable(
  "categorization_rules",
  {
    id: id(),
    userId: userId(),
    match: ruleMatch("match").notNull().default("contains"),
    /** Se compara contra el comercio normalizado (mayúsculas, sin tildes ni espacios dobles). */
    pattern: text("pattern").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    /** Mayor = se evalúa primero. Las aprendidas por corrección entran con prioridad alta. */
    priority: smallint("priority").notNull().default(100),
    learned: boolean("learned").notNull().default(false),
    hits: integer("hits").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("categorization_rules_user_idx").on(t.userId, t.priority),
    uniqueIndex("categorization_rules_uq")
      .on(t.userId, t.match, t.pattern)
      .where(sql`${t.deletedAt} is null`),
  ],
);

// ─── Ingesta ─────────────────────────────────────────────────────────────────

export const ingestEvents = pgTable(
  "ingest_events",
  {
    id: id(),
    userId: userId(),
    tokenId: uuid("token_id").references(() => apiTokens.id),
    source: txnSource("source").notNull(),
    sender: text("sender").notNull(),
    rawText: text("raw_text").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    contentHash: text("content_hash").notNull(),
    idempotencyKey: text("idempotency_key"),
    status: ingestStatus("status").notNull().default("received"),
    parserId: text("parser_id"),
    parserVersion: smallint("parser_version"),
    confidence: real("confidence"),
    parsed: jsonb("parsed"),
    error: text("error"),
    /** Mensaje corto devuelto al cliente (se repite en duplicados). */
    replyText: text("reply_text"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ingest_events_hash_uq").on(t.userId, t.contentHash),
    uniqueIndex("ingest_events_idem_uq")
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index("ingest_events_status_idx").on(t.userId, t.status, t.createdAt),
  ],
);

// ─── Movimientos ─────────────────────────────────────────────────────────────

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    userId: userId(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    kind: txnKind("kind").notNull(),
    status: txnStatus("status").notNull().default("posted"),
    source: txnSource("source").notNull(),
    /** Con signo: negativo = sale de la cuenta (o aumenta deuda en tarjeta). */
    amountMinor: money("amount_minor").notNull(),
    currency: currency("currency").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    merchant: text("merchant"),
    merchantNormalized: text("merchant_normalized"),
    description: text("description"),
    categoryId: uuid("category_id").references(() => categories.id),
    incomeSourceId: uuid("income_source_id").references(() => incomeSources.id),
    recurringExpenseId: uuid("recurring_expense_id").references(() => recurringExpenses.id),
    ingestEventId: uuid("ingest_event_id").references(() => ingestEvents.id),
    confidence: real("confidence"),
    /** Para reversos: transacción original. */
    reversesId: uuid("reverses_id"),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("transactions_user_date_idx").on(t.userId, t.occurredAt.desc()),
    index("transactions_account_date_idx").on(t.accountId, t.occurredAt),
    index("transactions_category_idx").on(t.userId, t.categoryId, t.occurredAt),
    index("transactions_review_idx")
      .on(t.userId, t.status)
      .where(sql`${t.status} = 'pending_review'`),
    index("transactions_merchant_idx").on(t.userId, t.merchantNormalized),
    check("transactions_amount_nonzero_chk", sql`${t.amountMinor} <> 0`),
  ],
);

/** Une las dos patas de un movimiento entre cuentas propias (incluye pago de tarjeta y retiro a efectivo). */
export const transfers = pgTable(
  "transfers",
  {
    id: id(),
    userId: userId(),
    fromTransactionId: uuid("from_transaction_id")
      .notNull()
      .unique()
      .references(() => transactions.id),
    toTransactionId: uuid("to_transaction_id")
      .notNull()
      .unique()
      .references(() => transactions.id),
    /** Si las monedas difieren (pago de deuda USD con soles). */
    fxRate: numeric("fx_rate", { precision: 12, scale: 6 }),
    createdAt: createdAt(),
  },
  (t) => [check("transfers_distinct_chk", sql`${t.fromTransactionId} <> ${t.toTransactionId}`)],
);

// ─── Ingresos y gastos fijos ─────────────────────────────────────────────────

export const incomeSources = pgTable(
  "income_sources",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(), // "Sueldo", "Ventas diarias"
    isSalary: boolean("is_salary").notNull().default(false),
    categoryId: uuid("category_id").references(() => categories.id),
    expectedAmountMinor: money("expected_amount_minor"),
    currency: currency("currency").notNull().default("PEN"),
    /** Tolerancia para conciliar el depósito (ej. 10 = ±10%). */
    amountTolerancePct: smallint("amount_tolerance_pct").notNull().default(10),
    frequency: frequency("frequency"),
    /** Para mensual: día esperado (27). */
    expectedDay: smallint("expected_day"),
    payAdjust: businessDayAdjust("pay_adjust").notNull().default("previous"),
    destinationAccountId: uuid("destination_account_id").references(() => accounts.id),
    /** Palabras que identifican el depósito en el texto del banco: ["PLANILLA"]. */
    keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
    graceDays: smallint("grace_days").notNull().default(2),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("income_sources_user_idx").on(t.userId)],
);

export const recurringExpenses = pgTable(
  "recurring_expenses",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    amountMinor: money("amount_minor").notNull(),
    currency: currency("currency").notNull().default("PEN"),
    frequency: frequency("frequency").notNull().default("monthly"),
    dueDay: smallint("due_day").notNull(),
    paymentAccountId: uuid("payment_account_id").references(() => accounts.id),
    merchantPattern: text("merchant_pattern"),
    isSubscription: boolean("is_subscription").notNull().default(false),
    remindDaysBefore: smallint("remind_days_before").notNull().default(3),
    /** Sugerido por el detector; queda inactivo hasta que lo confirmes. */
    suggested: boolean("suggested").notNull().default(false),
    active: boolean("active").notNull().default(true),
    lastChargedAt: timestamp("last_charged_at", { withTimezone: true }),
    lastAmountMinor: money("last_amount_minor"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("recurring_expenses_user_idx").on(t.userId, t.active)],
);

// ─── Presupuesto y metas ─────────────────────────────────────────────────────

export const budgets = pgTable(
  "budgets",
  {
    id: id(),
    userId: userId(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    /** Primer día del mes (2026-11-01). Null = presupuesto base que se repite. */
    month: date("month"),
    amountMinor: money("amount_minor").notNull(),
    currency: currency("currency").notNull().default("PEN"),
    alertPct: smallint("alert_pct").notNull().default(80),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("budgets_uq")
      .on(t.userId, t.categoryId, t.month)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const savingsGoals = pgTable("savings_goals", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  targetMinor: money("target_minor").notNull(),
  currency: currency("currency").notNull().default("PEN"),
  targetDate: date("target_date"),
  /** Si se vincula a una cuenta, el avance = saldo de esa cuenta. */
  accountId: uuid("account_id").references(() => accounts.id),
  manualProgressMinor: money("manual_progress_minor").notNull().default(0),
  color: text("color"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

// ─── Alertas y notificaciones ────────────────────────────────────────────────

export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    userId: userId(),
    type: alertType("type").notNull(),
    severity: alertSeverity("severity").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Evita duplicar la misma alerta (ej. "card_payment_due:<cardId>:2026-11-19:d3"). */
    dedupeKey: text("dedupe_key").notNull(),
    data: jsonb("data"),
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("alerts_dedupe_uq").on(t.userId, t.dedupeKey),
    index("alerts_unread_idx").on(t.userId, t.readAt),
  ],
);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  userId: userId(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  failures: smallint("failures").notNull().default(0),
  createdAt: createdAt(),
});

// ─── Referencia: tipo de cambio y feriados ───────────────────────────────────

export const exchangeRates = pgTable(
  "exchange_rates",
  {
    day: date("day").notNull(),
    base: currency("base").notNull(), // USD
    quote: currency("quote").notNull(), // PEN
    rate: numeric("rate", { precision: 12, scale: 6 }).notNull(),
    source: fxSource("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.day, t.base, t.quote] })],
);

/** Feriados nacionales de Perú (semilla anual). Global, no por usuario. */
export const holidays = pgTable("holidays", {
  day: date("day").primaryKey(),
  name: text("name").notNull(),
  country: text("country").notNull().default("PE"),
});

/** Ventana fija por token. Se purga en el cron diario. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

// ─── Auditoría ───────────────────────────────────────────────────────────────

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    userId: userId(),
    entity: text("entity").notNull(), // "transactions"
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(), // create | update | delete | restore
    /** Solo campos cambiados: { field: [antes, después] }. */
    diff: jsonb("diff"),
    actor: text("actor").notNull(), // "user" | "ingest:<tokenPrefix>" | "cron"
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId, t.createdAt)],
);

// ─── Relaciones ──────────────────────────────────────────────────────────────

export const creditCardsRelations = relations(creditCards, ({ many }) => ({
  accounts: many(accounts),
  statements: many(cardStatements),
  installmentPlans: many(installmentPlans),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  creditCard: one(creditCards, { fields: [accounts.creditCardId], references: [creditCards.id] }),
  transactions: many(transactions),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  account: one(accounts, { fields: [transactions.accountId], references: [accounts.id] }),
  category: one(categories, { fields: [transactions.categoryId], references: [categories.id] }),
  ingestEvent: one(ingestEvents, {
    fields: [transactions.ingestEventId],
    references: [ingestEvents.id],
  }),
}));

export const installmentPlansRelations = relations(installmentPlans, ({ one, many }) => ({
  card: one(creditCards, { fields: [installmentPlans.creditCardId], references: [creditCards.id] }),
  installments: many(installments),
}));

export const installmentsRelations = relations(installments, ({ one }) => ({
  plan: one(installmentPlans, { fields: [installments.planId], references: [installmentPlans.id] }),
}));
