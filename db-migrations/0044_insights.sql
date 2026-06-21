-- Phase 28 — Workspace Insights & Reporting (Pillar AL)
--
-- Adds three tables that overlay the existing usage / audit / teams /
-- billing / jobs / exports / inbox surfaces with reusable report
-- definitions, immutable snapshots, and tokenised read-only share links.
--
-- All read-side `insights.*` capabilities run on the existing
-- `public_api_key_usage` + `public_api_audit_log` + `public_api_team_audit`
-- tables — no new fact tables required. These three are only for the
-- saved-report layer.

CREATE TABLE IF NOT EXISTS public.public_api_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key_id          uuid NOT NULL REFERENCES public.public_api_keys(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  sections        jsonb NOT NULL DEFAULT '[]',     -- array of {type, params}
  filters         jsonb NOT NULL DEFAULT '{}',     -- {windowDays, teamId, capabilityPrefix, ...}
  schedule_seconds integer NOT NULL DEFAULT 0,     -- 0 = on-demand only
  enabled         boolean NOT NULL DEFAULT true,
  last_run_at     timestamptz,
  last_snapshot_id uuid,
  run_count       integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS public_api_reports_user_name_uq
  ON public.public_api_reports (user_id, name);
CREATE INDEX IF NOT EXISTS public_api_reports_user_idx
  ON public.public_api_reports (user_id, created_at);
CREATE INDEX IF NOT EXISTS public_api_reports_enabled_idx
  ON public.public_api_reports (enabled, schedule_seconds)
  WHERE enabled = true AND schedule_seconds > 0;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_reports TO authenticated;
GRANT ALL ON public.public_api_reports TO service_role;

CREATE TABLE IF NOT EXISTS public.public_api_report_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       uuid NOT NULL REFERENCES public.public_api_reports(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key_id          uuid REFERENCES public.public_api_keys(id) ON DELETE SET NULL,
  trigger         text NOT NULL DEFAULT 'manual',  -- manual | scheduled | webhook
  window_start    timestamptz NOT NULL,
  window_end      timestamptz NOT NULL,
  summary         jsonb NOT NULL DEFAULT '{}',     -- top-line numbers + counts
  payload         jsonb NOT NULL DEFAULT '{}',     -- full per-section payload
  size_bytes      integer NOT NULL DEFAULT 0,
  generated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_api_report_snapshots_report_idx
  ON public.public_api_report_snapshots (report_id, generated_at);
CREATE INDEX IF NOT EXISTS public_api_report_snapshots_user_idx
  ON public.public_api_report_snapshots (user_id, generated_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_report_snapshots TO authenticated;
GRANT ALL ON public.public_api_report_snapshots TO service_role;

CREATE TABLE IF NOT EXISTS public.public_api_report_shares (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     uuid NOT NULL REFERENCES public.public_api_report_snapshots(id) ON DELETE CASCADE,
  report_id       uuid NOT NULL REFERENCES public.public_api_reports(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key_id          uuid REFERENCES public.public_api_keys(id) ON DELETE SET NULL,
  token           text NOT NULL,
  password_hash   text,                            -- optional sha256
  expires_at      timestamptz NOT NULL,
  view_count      integer NOT NULL DEFAULT 0,
  last_viewed_at  timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS public_api_report_shares_token_uq
  ON public.public_api_report_shares (token);
CREATE INDEX IF NOT EXISTS public_api_report_shares_user_idx
  ON public.public_api_report_shares (user_id, created_at);
CREATE INDEX IF NOT EXISTS public_api_report_shares_snapshot_idx
  ON public.public_api_report_shares (snapshot_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_report_shares TO authenticated;
GRANT ALL ON public.public_api_report_shares TO service_role;
GRANT SELECT ON public.public_api_report_shares TO anon;  -- public share resolution by token

ALTER TABLE public.public_api_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_api_report_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_api_report_shares ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY public_api_reports_owner ON public.public_api_reports
    FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY public_api_report_snapshots_owner ON public.public_api_report_snapshots
    FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY public_api_report_shares_owner ON public.public_api_report_shares
    FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY public_api_report_shares_public_read ON public.public_api_report_shares
    FOR SELECT TO anon
    USING (revoked_at IS NULL AND expires_at > now());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
