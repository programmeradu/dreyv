-- Apply with: psql "$DATABASE_URL" -f db-migrations/0041_inbox.sql
--
-- Phase 25 — Inbox & Digests (Pillar AI).
--
-- Adds two overlay tables on top of the existing `notifications` table:
--
--   public_api_inbox_state    — per-notification state (archived / snoozed /
--                               pinned / threadKey) so callers can build a
--                               real inbox UI without mutating the legacy
--                               notification row.
--   public_api_inbox_digests  — user-defined digest schedules: filters
--                               (types, severities, since), delivery channel,
--                               last-run pointer, enabled flag.
--
-- Digest runs are evaluated server-side via the `inbox.digests_run`
-- capability and either return a preview (channel='preview') or emit one
-- summary notification (channel='inbox') plus an `inbox.digest_ready`
-- webhook event.

CREATE TABLE IF NOT EXISTS "public_api_inbox_state" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"         uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "notification_id" integer NOT NULL REFERENCES "notifications"("id") ON DELETE CASCADE,
  "thread_key"      text,                                       -- e.g. "proposal:42" or metadata.threadKey
  "archived"        boolean NOT NULL DEFAULT false,
  "archived_at"     timestamptz,
  "snoozed_until"   timestamptz,
  "pinned"          boolean NOT NULL DEFAULT false,
  "pinned_at"       timestamptz,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "public_api_inbox_state_notif_uq" ON "public_api_inbox_state" ("notification_id");
CREATE INDEX IF NOT EXISTS "public_api_inbox_state_user_idx"     ON "public_api_inbox_state" ("user_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "public_api_inbox_state_thread_idx"   ON "public_api_inbox_state" ("user_id", "thread_key");
CREATE INDEX IF NOT EXISTS "public_api_inbox_state_snooze_idx"   ON "public_api_inbox_state" ("user_id", "snoozed_until") WHERE "snoozed_until" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "public_api_inbox_digests" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"       uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "key_id"        uuid NOT NULL REFERENCES "public_api_keys"("id") ON DELETE CASCADE,
  "name"          text NOT NULL,
  "filters"       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { types?:string[], severities?:string[], since?:iso, threadKey?:string }
  "channel"       text NOT NULL DEFAULT 'inbox',         -- inbox | preview
  "schedule_seconds" integer NOT NULL DEFAULT 86400,     -- min interval between runs (>=300s)
  "enabled"       boolean NOT NULL DEFAULT true,
  "last_run_at"   timestamptz,
  "last_match_count" integer NOT NULL DEFAULT 0,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "public_api_inbox_digests_user_name_uq" ON "public_api_inbox_digests" ("user_id", "name");
CREATE INDEX IF NOT EXISTS "public_api_inbox_digests_user_idx" ON "public_api_inbox_digests" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "public_api_inbox_digests_enabled_idx" ON "public_api_inbox_digests" ("user_id", "enabled") WHERE "enabled" = true;
