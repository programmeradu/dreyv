-- Apply with: psql "$DATABASE_URL" -f db-migrations/0040_flags.sql
--
-- Phase 24 — Feature Flags & Experiments (Pillar AH).
--
-- Server-evaluated feature flags scoped to a user. Each flag has a typed
-- default plus an ordered list of `rules` (jsonb). Evaluation runs in-
-- process against a caller-supplied context (`{ userId, env, country, ... }`)
-- and returns the first matching rule's value, falling back to the default.
-- Every evaluation appends a thin log row for analytics + audit.

CREATE TABLE IF NOT EXISTS "public_api_flags" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"        uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "key_id"         uuid NOT NULL REFERENCES "public_api_keys"("id") ON DELETE CASCADE,
  "key"            text NOT NULL,                            -- normalized slug, unique per user
  "display"        text NOT NULL,                            -- relabel surface
  "description"    text,
  "type"           text NOT NULL,                            -- boolean | string | number | json
  "default_value"  jsonb NOT NULL,
  "rules"          jsonb NOT NULL DEFAULT '[]'::jsonb,       -- ordered: [{ when:{...}, value:any, note?:text }]
  "enabled"        boolean NOT NULL DEFAULT true,
  "archived_at"    timestamptz,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "public_api_flags_user_key_uq" ON "public_api_flags" ("user_id", "key");
CREATE INDEX IF NOT EXISTS "public_api_flags_user_idx" ON "public_api_flags" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "public_api_flags_enabled_idx" ON "public_api_flags" ("user_id", "enabled") WHERE "archived_at" IS NULL;

CREATE TABLE IF NOT EXISTS "public_api_flag_evaluations" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"     uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "flag_id"     uuid NOT NULL REFERENCES "public_api_flags"("id") ON DELETE CASCADE,
  "key"         text NOT NULL,
  "matched_rule" integer,                                    -- null = default branch
  "value"       jsonb NOT NULL,
  "context_hash" text NOT NULL,                              -- sha256(canonical(context))
  "context"     jsonb NOT NULL DEFAULT '{}'::jsonb,          -- redacted to <=2KiB
  "created_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "public_api_flag_evals_user_ts_idx" ON "public_api_flag_evaluations" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "public_api_flag_evals_flag_ts_idx" ON "public_api_flag_evaluations" ("flag_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "public_api_flag_evals_hash_idx"    ON "public_api_flag_evaluations" ("flag_id", "context_hash");
