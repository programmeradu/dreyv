-- Apply with: psql "$DATABASE_URL" -f db-migrations/0043_billing.sql
--
-- Phase 27 — Billing, Usage & Quotas (Pillar AK).
--
-- The legacy billing pillar already covers tier introspection, invoice
-- listing, and crypto upgrade quotes. Phase 27 adds the operational
-- surface on top:
--
--   public_api_billing_alerts  — user-defined usage threshold alarms.
--                                Each alert binds a metric (calls | credits),
--                                a scope window (monthly | daily), and a
--                                threshold (% of the plan limit OR absolute
--                                count). When a usage probe crosses the
--                                threshold the alert fires
--                                `billing.quota_threshold` and writes one
--                                inbox notification, then debounces via
--                                `last_triggered_at` for the rest of the
--                                window.

CREATE TABLE IF NOT EXISTS "public_api_billing_alerts" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"           uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "key_id"            uuid NOT NULL REFERENCES "public_api_keys"("id") ON DELETE CASCADE,
  "name"              text NOT NULL,
  "metric"            text NOT NULL DEFAULT 'calls',        -- calls | credits
  "scope"             text NOT NULL DEFAULT 'monthly',      -- monthly | daily
  "threshold_pct"     integer,                              -- 1..100, plan-relative
  "threshold_abs"     numeric(14, 4),                       -- absolute count/credits
  "channel"           text NOT NULL DEFAULT 'inbox',        -- inbox | webhook
  "enabled"           boolean NOT NULL DEFAULT true,
  "last_triggered_at" timestamptz,
  "last_value"        numeric(14, 4) NOT NULL DEFAULT 0,
  "fire_count"        integer NOT NULL DEFAULT 0,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "public_api_billing_alerts_user_name_uq" ON "public_api_billing_alerts" ("user_id", "name");
CREATE INDEX IF NOT EXISTS "public_api_billing_alerts_user_idx"    ON "public_api_billing_alerts" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "public_api_billing_alerts_enabled_idx" ON "public_api_billing_alerts" ("user_id", "enabled") WHERE "enabled" = true;
