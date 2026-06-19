-- Apply with: psql "$DATABASE_URL" -f db-migrations/0026_agent_x402.sql
--
-- Agent payment rails (x402-style):
--   • agent_api_keys  — per-user API keys an autonomous agent presents on each call
--   • agent_payments  — links an api key + sku + crypto_invoice into one billable record,
--                       and stores the receipt token an agent uses to claim the fulfilment.

CREATE TABLE IF NOT EXISTS "agent_api_keys" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"         uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "label"           text NOT NULL,
  "key_prefix"      text NOT NULL,
  "key_hash"        text NOT NULL,
  "scopes"          text NOT NULL DEFAULT 'x402.pay',
  "spend_limit_usd" numeric(12, 2),
  "spent_usd"       numeric(14, 4) NOT NULL DEFAULT 0,
  "last_used_at"    timestamptz,
  "revoked_at"      timestamptz,
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_api_keys_hash_uniq" ON "agent_api_keys" ("key_hash");
CREATE INDEX        IF NOT EXISTS "agent_api_keys_user_idx"  ON "agent_api_keys" ("user_id");

CREATE TABLE IF NOT EXISTS "agent_payments" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "api_key_id"     uuid NOT NULL REFERENCES "agent_api_keys"("id") ON DELETE CASCADE,
  "user_id"        uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "invoice_id"     uuid NOT NULL REFERENCES "crypto_invoices"("id") ON DELETE CASCADE,
  "sku"            text NOT NULL,
  "amount_usd"     numeric(12, 2) NOT NULL,
  "status"         text NOT NULL DEFAULT 'pending',  -- pending | paid | expired | failed
  "tx_signature"   text,
  "receipt_token"  text,
  "paid_at"        timestamptz,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_payments_receipt_uniq" ON "agent_payments" ("receipt_token") WHERE "receipt_token" IS NOT NULL;
CREATE INDEX        IF NOT EXISTS "agent_payments_key_idx"      ON "agent_payments" ("api_key_id");
CREATE INDEX        IF NOT EXISTS "agent_payments_invoice_idx"  ON "agent_payments" ("invoice_id");
CREATE INDEX        IF NOT EXISTS "agent_payments_user_idx"     ON "agent_payments" ("user_id");
