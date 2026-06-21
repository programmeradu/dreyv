-- Phase 11 — Safety, policy, and key lifecycle for public Dreyv API keys.
-- Adds kill-switch + allowlists to public_api_keys and a hash-chained audit log.
-- NOTE: This database is Neon Postgres (not Supabase). No `service_role`/`authenticated`
-- roles exist and RLS is not used — access control is enforced in the app layer.

ALTER TABLE public.public_api_keys
  ADD COLUMN IF NOT EXISTS kill_switch_at timestamptz,
  ADD COLUMN IF NOT EXISTS ip_allowlist text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS origin_allowlist text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS capability_allowlist text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.public_api_audit_log (
  id            bigserial PRIMARY KEY,
  key_id        uuid NOT NULL REFERENCES public.public_api_keys(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action        text NOT NULL,
  target        text,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash     text NOT NULL DEFAULT '',
  hash          text NOT NULL,
  ts            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_api_audit_log_key_ts_idx
  ON public.public_api_audit_log(key_id, ts DESC);
CREATE INDEX IF NOT EXISTS public_api_audit_log_user_ts_idx
  ON public.public_api_audit_log(user_id, ts DESC);
