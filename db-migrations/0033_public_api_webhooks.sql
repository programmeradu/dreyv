-- Apply with: psql "$DATABASE_URL" -f db-migrations/0033_public_api_webhooks.sql
-- Or via /admin/migrations.
--
-- Phase 5 — Outbound Webhooks & Delivery Log.
--
-- A webhook belongs to a public API key (and therefore a user). Dreyv POSTs
-- signed JSON to `target_url` whenever a subscribed event fires for that
-- user. Each delivery attempt is logged so the customer can inspect/replay.

CREATE TABLE IF NOT EXISTS "public_api_webhooks" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"        uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "key_id"         uuid NOT NULL REFERENCES "public_api_keys"("id") ON DELETE CASCADE,
  "label"          text NOT NULL,
  "target_url"     text NOT NULL,                       -- https only enforced in app
  "signing_secret" text NOT NULL,                       -- raw secret, used for HMAC
  "events"         text NOT NULL,                       -- comma-separated event names or '*'
  "active"         boolean NOT NULL DEFAULT true,
  "last_delivery_at" timestamptz,
  "last_status"    text,                                -- ok | failed | retrying
  "failure_streak" integer NOT NULL DEFAULT 0,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "public_api_webhooks_user_idx"   ON "public_api_webhooks" ("user_id");
CREATE INDEX IF NOT EXISTS "public_api_webhooks_key_idx"    ON "public_api_webhooks" ("key_id");
CREATE INDEX IF NOT EXISTS "public_api_webhooks_active_idx" ON "public_api_webhooks" ("active");

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "webhook_id"    uuid NOT NULL REFERENCES "public_api_webhooks"("id") ON DELETE CASCADE,
  "user_id"       uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event"         text NOT NULL,                  -- e.g. "watcher.delta"
  "payload"       jsonb NOT NULL,                 -- exact body that was POSTed
  "attempt"       integer NOT NULL DEFAULT 1,     -- 1..N retries
  "status"        text NOT NULL DEFAULT 'pending',-- pending | ok | failed
  "http_status"   integer,
  "response_body" text,                           -- truncated to ~4k
  "error"         text,
  "latency_ms"    integer,
  "next_retry_at" timestamptz,
  "delivered_at"  timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "webhook_deliveries_hook_ts_idx"   ON "webhook_deliveries" ("webhook_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "webhook_deliveries_user_ts_idx"   ON "webhook_deliveries" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "webhook_deliveries_event_ts_idx"  ON "webhook_deliveries" ("event", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_idx"    ON "webhook_deliveries" ("status");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_retry_idx"     ON "webhook_deliveries" ("next_retry_at") WHERE "status" = 'failed';
