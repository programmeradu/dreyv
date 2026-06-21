-- Apply with: psql "$DATABASE_URL" -f db-migrations/0032_public_api_keys.sql
--
-- Public Dreyv API keys (dk_live_… / dk_test_…) + per-call usage metering.
-- Distinct from agent_api_keys (dak_…) which are payment-only.
--
-- A public key authenticates REST (/api/v1/*) and MCP (/api/mcp) calls.
-- Scopes are stored as comma-separated text for simple bearer-time checks.

CREATE TABLE IF NOT EXISTS "public_api_keys" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"        uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "label"          text NOT NULL,
  "env"            text NOT NULL DEFAULT 'live',   -- live | test
  "key_prefix"     text NOT NULL,                  -- e.g. "dk_live_abcd1234"
  "key_hash"       text NOT NULL,                  -- sha256(full)
  "scopes"         text NOT NULL DEFAULT 'read:portfolio,read:treasury,read:market',
  "rate_limit_rpm" integer NOT NULL DEFAULT 120,   -- per-minute cap
  "last_used_at"   timestamptz,
  "revoked_at"     timestamptz,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "public_api_keys_hash_uniq" ON "public_api_keys" ("key_hash");
CREATE INDEX        IF NOT EXISTS "public_api_keys_user_idx"  ON "public_api_keys" ("user_id");
CREATE INDEX        IF NOT EXISTS "public_api_keys_env_idx"   ON "public_api_keys" ("env");

CREATE TABLE IF NOT EXISTS "public_api_key_usage" (
  "id"            bigserial PRIMARY KEY,
  "key_id"        uuid NOT NULL REFERENCES "public_api_keys"("id") ON DELETE CASCADE,
  "user_id"       uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "capability_id" text NOT NULL,
  "transport"     text NOT NULL DEFAULT 'rest',   -- rest | mcp
  "status"        text NOT NULL DEFAULT 'ok',     -- ok | error | denied | rate_limited
  "latency_ms"    integer,
  "cost_credits"  numeric(10, 4) NOT NULL DEFAULT 0,
  "error_code"    text,
  "ts"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "public_api_key_usage_key_ts_idx"  ON "public_api_key_usage" ("key_id", "ts" DESC);
CREATE INDEX IF NOT EXISTS "public_api_key_usage_user_ts_idx" ON "public_api_key_usage" ("user_id", "ts" DESC);
CREATE INDEX IF NOT EXISTS "public_api_key_usage_cap_ts_idx"  ON "public_api_key_usage" ("capability_id", "ts" DESC);
