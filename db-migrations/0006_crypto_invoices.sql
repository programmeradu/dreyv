-- Apply with: psql "$DATABASE_URL" -f db-migrations/0006_crypto_invoices.sql
-- Or copy into drizzle/0006_crypto_invoices.sql in your repo and run drizzle-kit migrate.

CREATE TABLE IF NOT EXISTS "crypto_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tier" text NOT NULL,
  "chain" text NOT NULL,
  "asset" text NOT NULL,
  "amount_minor" numeric(40, 0) NOT NULL,
  "amount_usd" numeric(12, 2) NOT NULL,
  "decimals" integer NOT NULL,
  "contract_address" text,
  "receiving_address" text NOT NULL,
  "memo" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "tx_signature" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "confirmed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "crypto_invoices_user_idx" ON "crypto_invoices" ("user_id");
CREATE INDEX IF NOT EXISTS "crypto_invoices_status_idx" ON "crypto_invoices" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "crypto_invoices_memo_uniq" ON "crypto_invoices" ("memo");
CREATE UNIQUE INDEX IF NOT EXISTS "crypto_invoices_tx_uniq" ON "crypto_invoices" ("tx_signature") WHERE "tx_signature" IS NOT NULL;
