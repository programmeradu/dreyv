-- Apply with: psql "$DATABASE_URL" -f db-migrations/0042_teams.sql
--
-- Phase 26 — Teams, Members & Invites (Pillar AJ).
--
-- The legacy `teams`, `team_members`, and `team_invitations` tables already
-- exist (see src/db/schema.ts). Phase 26 adds ONE overlay table so the
-- public API can attach a hash-chained audit log to every team mutation
-- (create / rename / delete / invite / role-change / remove) without
-- touching the legacy rows.
--
--   public_api_team_audit  — per-team hash-chained audit. Each row stores
--                            { keyId, userId, teamId, action, target, meta,
--                              prevHash, hash, ts }. `hash` =
--                            sha256(prev || canonical(payload, second-pinned ts)).
--                            Same construction as `public_api_audit_log`,
--                            scoped per-team for easy export.

CREATE TABLE IF NOT EXISTS "public_api_team_audit" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "team_id"    uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "key_id"     uuid NOT NULL REFERENCES "public_api_keys"("id") ON DELETE CASCADE,
  "user_id"    uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "action"     text NOT NULL,
  "target"     text,
  "meta"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "prev_hash"  text NOT NULL DEFAULT '',
  "hash"       text NOT NULL,
  "ts"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "public_api_team_audit_team_ts_idx" ON "public_api_team_audit" ("team_id", "ts" DESC);
CREATE INDEX IF NOT EXISTS "public_api_team_audit_user_ts_idx" ON "public_api_team_audit" ("user_id", "ts" DESC);
CREATE INDEX IF NOT EXISTS "public_api_team_audit_key_ts_idx"  ON "public_api_team_audit" ("key_id",  "ts" DESC);
CREATE INDEX IF NOT EXISTS "public_api_team_audit_action_idx"  ON "public_api_team_audit" ("team_id", "action", "ts" DESC);
