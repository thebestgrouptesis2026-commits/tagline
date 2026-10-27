CREATE TYPE "public"."account_type" AS ENUM('checking', 'savings', 'cash', 'wallet', 'debit_card', 'credit_card');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('card_payment_due', 'fixed_expense_due', 'salary_missing', 'budget_near', 'budget_exceeded', 'credit_usage_high', 'unusual_spend', 'recurring_amount_changed', 'recurring_detected', 'parser_failed');--> statement-breakpoint
CREATE TYPE "public"."business_day_adjust" AS ENUM('none', 'previous', 'next');--> statement-breakpoint
CREATE TYPE "public"."card_network" AS ENUM('visa', 'mastercard', 'amex', 'diners');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('PEN', 'USD');--> statement-breakpoint
CREATE TYPE "public"."frequency" AS ENUM('weekly', 'biweekly', 'semimonthly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."fx_source" AS ENUM('manual', 'api');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('received', 'parsed', 'needs_review', 'duplicate', 'ignored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."installment_status" AS ENUM('active', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."rule_match" AS ENUM('contains', 'equals', 'starts_with', 'regex');--> statement-breakpoint
CREATE TYPE "public"."token_scope" AS ENUM('ingest:all', 'ingest:manual');--> statement-breakpoint
CREATE TYPE "public"."txn_kind" AS ENUM('purchase', 'deposit', 'salary', 'income_other', 'transfer_out', 'transfer_in', 'cash_withdrawal', 'card_payment', 'refund', 'fee', 'interest', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."txn_source" AS ENUM('sms', 'email', 'manual', 'recurring', 'import');--> statement-breakpoint
CREATE TYPE "public"."txn_status" AS ENUM('posted', 'pending_review', 'voided');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "account_type" NOT NULL,
	"name" text NOT NULL,
	"bank" text,
	"currency" "currency" NOT NULL,
	"last4" text,
	"parent_account_id" uuid,
	"credit_card_id" uuid,
	"opening_balance_minor" bigint DEFAULT 0 NOT NULL,
	"opening_balance_at" timestamp with time zone DEFAULT now() NOT NULL,
	"color" text DEFAULT '#828384' NOT NULL,
	"include_in_net_worth" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "accounts_last4_chk" CHECK ("accounts"."last4" is null or "accounts"."last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "accounts_card_link_chk" CHECK (("accounts"."type" = 'credit_card') = ("accounts"."credit_card_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "alert_type" NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"data" jsonb,
	"pushed_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scope" "token_scope" DEFAULT 'ingest:all' NOT NULL,
	"hmac_secret_enc" text,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"diff" jsonb,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "auth_accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authenticators" (
	"credential_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_account_id" text NOT NULL,
	"credential_public_key" text NOT NULL,
	"counter" integer NOT NULL,
	"credential_device_type" text NOT NULL,
	"credential_backed_up" boolean NOT NULL,
	"transports" text,
	CONSTRAINT "authenticators_user_id_credential_id_pk" PRIMARY KEY("user_id","credential_id"),
	CONSTRAINT "authenticators_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"month" date,
	"amount_minor" bigint NOT NULL,
	"currency" "currency" DEFAULT 'PEN' NOT NULL,
	"alert_pct" smallint DEFAULT 80 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "card_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credit_card_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"period_start" date NOT NULL,
	"closing_date" date NOT NULL,
	"due_date" date NOT NULL,
	"total_due_minor" bigint,
	"minimum_due_minor" bigint,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"source" "txn_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "category_kind" NOT NULL,
	"icon" text,
	"color" text,
	"parent_id" uuid,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "categorization_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"match" "rule_match" DEFAULT 'contains' NOT NULL,
	"pattern" text NOT NULL,
	"category_id" uuid NOT NULL,
	"priority" smallint DEFAULT 100 NOT NULL,
	"learned" boolean DEFAULT false NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "credit_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bank" text NOT NULL,
	"name" text NOT NULL,
	"network" "card_network" NOT NULL,
	"last4" text NOT NULL,
	"limit_minor" bigint NOT NULL,
	"limit_currency" "currency" DEFAULT 'PEN' NOT NULL,
	"closing_day" smallint NOT NULL,
	"due_day" smallint NOT NULL,
	"due_adjust" "business_day_adjust" DEFAULT 'previous' NOT NULL,
	"closing_adjust" "business_day_adjust" DEFAULT 'none' NOT NULL,
	"default_installment_tea" numeric(7, 4),
	"usage_alert_pct" smallint DEFAULT 70 NOT NULL,
	"color" text DEFAULT '#af50ff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "credit_cards_last4_chk" CHECK ("credit_cards"."last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "credit_cards_closing_chk" CHECK ("credit_cards"."closing_day" between 1 and 31),
	CONSTRAINT "credit_cards_due_chk" CHECK ("credit_cards"."due_day" between 1 and 31),
	CONSTRAINT "credit_cards_limit_chk" CHECK ("credit_cards"."limit_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"day" date NOT NULL,
	"base" "currency" NOT NULL,
	"quote" "currency" NOT NULL,
	"rate" numeric(12, 6) NOT NULL,
	"source" "fx_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_day_base_quote_pk" PRIMARY KEY("day","base","quote")
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"day" date PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" text DEFAULT 'PE' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "income_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_salary" boolean DEFAULT false NOT NULL,
	"category_id" uuid,
	"expected_amount_minor" bigint,
	"currency" "currency" DEFAULT 'PEN' NOT NULL,
	"amount_tolerance_pct" smallint DEFAULT 10 NOT NULL,
	"frequency" "frequency",
	"expected_day" smallint,
	"pay_adjust" "business_day_adjust" DEFAULT 'previous' NOT NULL,
	"destination_account_id" uuid,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"grace_days" smallint DEFAULT 2 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ingest_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_id" uuid,
	"source" "txn_source" NOT NULL,
	"sender" text NOT NULL,
	"raw_text" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"idempotency_key" text,
	"status" "ingest_status" DEFAULT 'received' NOT NULL,
	"parser_id" text,
	"parser_version" smallint,
	"confidence" real,
	"parsed" jsonb,
	"error" text,
	"reply_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credit_card_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"principal_minor" bigint NOT NULL,
	"count" smallint NOT NULL,
	"tea" numeric(7, 4),
	"first_due_cycle_closing" date NOT NULL,
	"status" "installment_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "installment_plans_count_chk" CHECK ("installment_plans"."count" between 2 and 60),
	CONSTRAINT "installment_plans_principal_chk" CHECK ("installment_plans"."principal_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"number" smallint NOT NULL,
	"cycle_closing" date NOT NULL,
	"amount_minor_estimated" bigint NOT NULL,
	"amount_minor_actual" bigint,
	"principal_minor" bigint NOT NULL,
	"interest_minor" bigint NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"last_success_at" timestamp with time zone,
	"failures" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" "currency" DEFAULT 'PEN' NOT NULL,
	"frequency" "frequency" DEFAULT 'monthly' NOT NULL,
	"due_day" smallint NOT NULL,
	"payment_account_id" uuid,
	"merchant_pattern" text,
	"is_subscription" boolean DEFAULT false NOT NULL,
	"remind_days_before" smallint DEFAULT 3 NOT NULL,
	"suggested" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_charged_at" timestamp with time zone,
	"last_amount_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "savings_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_minor" bigint NOT NULL,
	"currency" "currency" DEFAULT 'PEN' NOT NULL,
	"target_date" date,
	"account_id" uuid,
	"manual_progress_minor" bigint DEFAULT 0 NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "txn_kind" NOT NULL,
	"status" "txn_status" DEFAULT 'posted' NOT NULL,
	"source" "txn_source" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"merchant" text,
	"merchant_normalized" text,
	"description" text,
	"category_id" uuid,
	"income_source_id" uuid,
	"recurring_expense_id" uuid,
	"ingest_event_id" uuid,
	"confidence" real,
	"reverses_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "transactions_amount_nonzero_chk" CHECK ("transactions"."amount_minor" <> 0)
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_transaction_id" uuid NOT NULL,
	"to_transaction_id" uuid NOT NULL,
	"fx_rate" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_from_transaction_id_unique" UNIQUE("from_transaction_id"),
	CONSTRAINT "transfers_to_transaction_id_unique" UNIQUE("to_transaction_id"),
	CONSTRAINT "transfers_distinct_chk" CHECK ("transfers"."from_transaction_id" <> "transfers"."to_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"timezone" text DEFAULT 'America/Lima' NOT NULL,
	"base_currency" "currency" DEFAULT 'PEN' NOT NULL,
	"review_threshold" real DEFAULT 0.8 NOT NULL,
	"telegram_chat_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authenticators" ADD CONSTRAINT "authenticators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_statements" ADD CONSTRAINT "card_statements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_statements" ADD CONSTRAINT "card_statements_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_destination_account_id_accounts_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_events" ADD CONSTRAINT "ingest_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_events" ADD CONSTRAINT "ingest_events_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_plan_id_installment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."installment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_payment_account_id_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_income_source_id_income_sources_id_fk" FOREIGN KEY ("income_source_id") REFERENCES "public"."income_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_expense_id_recurring_expenses_id_fk" FOREIGN KEY ("recurring_expense_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_ingest_event_id_ingest_events_id_fk" FOREIGN KEY ("ingest_event_id") REFERENCES "public"."ingest_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_transaction_id_transactions_id_fk" FOREIGN KEY ("from_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_transaction_id_transactions_id_fk" FOREIGN KEY ("to_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "accounts_lookup_idx" ON "accounts" USING btree ("user_id","bank","last4");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_card_currency_uq" ON "accounts" USING btree ("credit_card_id","currency") WHERE "accounts"."credit_card_id" is not null and "accounts"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_dedupe_uq" ON "alerts" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "alerts_unread_idx" ON "alerts" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_uq" ON "budgets" USING btree ("user_id","category_id","month") WHERE "budgets"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "card_statements_uq" ON "card_statements" USING btree ("credit_card_id","currency","closing_date");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name_uq" ON "categories" USING btree ("user_id","kind","name") WHERE "categories"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "categorization_rules_user_idx" ON "categorization_rules" USING btree ("user_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "categorization_rules_uq" ON "categorization_rules" USING btree ("user_id","match","pattern") WHERE "categorization_rules"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "credit_cards_user_idx" ON "credit_cards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "income_sources_user_idx" ON "income_sources" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_events_hash_uq" ON "ingest_events" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_events_idem_uq" ON "ingest_events" USING btree ("user_id","idempotency_key") WHERE "ingest_events"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "ingest_events_status_idx" ON "ingest_events" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "installment_plans_card_idx" ON "installment_plans" USING btree ("credit_card_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "installments_plan_number_uq" ON "installments" USING btree ("plan_id","number");--> statement-breakpoint
CREATE INDEX "installments_cycle_idx" ON "installments" USING btree ("cycle_closing");--> statement-breakpoint
CREATE INDEX "recurring_expenses_user_idx" ON "recurring_expenses" USING btree ("user_id","active");--> statement-breakpoint
CREATE INDEX "transactions_user_date_idx" ON "transactions" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_account_date_idx" ON "transactions" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_category_idx" ON "transactions" USING btree ("user_id","category_id","occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_review_idx" ON "transactions" USING btree ("user_id","status") WHERE "transactions"."status" = 'pending_review';--> statement-breakpoint
CREATE INDEX "transactions_merchant_idx" ON "transactions" USING btree ("user_id","merchant_normalized");