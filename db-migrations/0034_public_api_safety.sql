-- Phase 11 — Safety, policy, and key lifecycle for public Dreyv API keys.
-- Adds kill-switch + allowlists to public_api_keys and a hash-chained audit log.

ALTER TABLE public.public_api_keys
  ADD COLUMN IF NOT EXISTS kill_switch_at timestamptz,
  ADD COLUMN IF NOT EXISTS ip_allowlist text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS origin_allowlist text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS capability_allowlist text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.public_api_audit_log (
  id            bigserial PRIMARY KEY,
  key_id        uuid NOT NULL REFERENCES public.public_api_keys(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action        text NOT NULL,                  -- policy.kill_switch / policy.allowlist / key.rotate / key.revoke / attest.mint / …
  target        text,                            -- e.g. capability id, allowlist kind, audience
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash     text NOT NULL DEFAULT '',
  hash          text NOT NULL,                   -- sha256(prev_hash || canonical(row))
  ts            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_api_audit_log_key_ts_idx
  ON public.public_api_audit_log(key_id, ts DESC);
CREATE INDEX IF NOT EXISTS public_api_audit_log_user_ts_idx
  ON public.public_api_audit_log(user_id, ts DESC);

GRANT SELECT, INSERT ON public.public_api_audit_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.public_api_audit_log_id_seq TO authenticated;
GRANT ALL ON public.public_api_audit_log TO service_role;
GRANT ALL ON SEQUENCE public.public_api_audit_log_id_seq TO service_role;

ALTER TABLE public.public_api_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_owner_select" ON public.public_api_audit_log;
CREATE POLICY "audit_owner_select" ON public.public_api_audit_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "audit_service_all" ON public.public_api_audit_log;
CREATE POLICY "audit_service_all" ON public.public_api_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
