-- Role bootstrap: ensure the roles referenced by GRANT exist (Neon-compat).
DO $bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$bootstrap$;

-- Phases 32–39 — Pillars AP → AX
--
-- One cohesive migration that lands eight net-new public-surface pillars:
--   AP  Observability (OTel-compatible traces / spans / metrics)
--   AQ  Audit log + evidence bundles (hash-chained, tamper-evident)
--   AR  Rate-limit & quota policies (per-key, per-route, burst)
--   AS  Data residency & region pinning
--   AT  Digests & multi-channel notifications (Slack/Telegram/email fan-out + quiet hours)
--   AU  Cross-entity search & discovery (full-text + saved searches)
--   AV  Workflow DAG engine (triggers → action graph with runs)
--   AX  Entitlements & plan enforcement (feature flags tied to billing tier)
--
-- 14 new tables. Each follows the project's standard four-step pattern:
--   CREATE TABLE → GRANT → ALTER ... ENABLE RLS → CREATE POLICY.

-- ═══════════════════════════════════════════════════════════════════════
-- AP. Observability — traces / spans / metrics
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.obs_traces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trace_id      text NOT NULL,
  service       text NOT NULL,
  root_name     text,
  start_ns      bigint NOT NULL,
  duration_ms   integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'ok',            -- ok | error | timeout
  span_count    integer NOT NULL DEFAULT 0,
  attributes    jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS obs_traces_user_trace_uq ON public.obs_traces (user_id, trace_id);
CREATE INDEX IF NOT EXISTS obs_traces_user_idx ON public.obs_traces (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS obs_traces_service_idx ON public.obs_traces (user_id, service, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.obs_traces TO authenticated;
GRANT ALL ON public.obs_traces TO service_role;
ALTER TABLE public.obs_traces ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY obs_traces_owner ON public.obs_traces FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS public.obs_spans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trace_id       text NOT NULL,
  span_id        text NOT NULL,
  parent_span_id text,
  name           text NOT NULL,
  kind           text NOT NULL DEFAULT 'internal',     -- internal | server | client | producer | consumer
  service        text,
  start_ns       bigint NOT NULL,
  duration_ms    integer NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'ok',
  attributes     jsonb NOT NULL DEFAULT '{}',
  events         jsonb NOT NULL DEFAULT '[]',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS obs_spans_user_span_uq ON public.obs_spans (user_id, trace_id, span_id);
CREATE INDEX IF NOT EXISTS obs_spans_trace_idx ON public.obs_spans (user_id, trace_id, start_ns);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.obs_spans TO authenticated;
GRANT ALL ON public.obs_spans TO service_role;
ALTER TABLE public.obs_spans ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY obs_spans_owner ON public.obs_spans FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS public.obs_metrics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'gauge',            -- counter | gauge | histogram
  value       numeric NOT NULL,
  unit        text,
  labels      jsonb NOT NULL DEFAULT '{}',
  ts          timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS obs_metrics_user_name_idx ON public.obs_metrics (user_id, name, ts DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.obs_metrics TO authenticated;
GRANT ALL ON public.obs_metrics TO service_role;
ALTER TABLE public.obs_metrics ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY obs_metrics_owner ON public.obs_metrics FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- AQ. Audit log — hash-chained, tamper-evident
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  seq          bigint NOT NULL,                       -- per-user monotonic sequence
  actor        text NOT NULL,                         -- 'user:<id>' | 'key:<id>' | 'system' | 'agent:<id>'
  action       text NOT NULL,                         -- e.g. 'capability.invoked', 'key.rotated'
  resource     text,                                  -- dot.path or URI
  payload      jsonb NOT NULL DEFAULT '{}',
  prev_hash    text NOT NULL,                         -- hex sha256 of previous row's hash (or zeros)
  hash         text NOT NULL,                         -- hex sha256(seq||actor||action||resource||payload||prev_hash)
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS audit_log_user_seq_uq ON public.audit_log (user_id, seq);
CREATE INDEX IF NOT EXISTS audit_log_user_time_idx ON public.audit_log (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON public.audit_log (user_id, action, occurred_at DESC);

GRANT SELECT, INSERT ON public.audit_log TO authenticated;       -- append-only by design
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY audit_log_owner_read ON public.audit_log FOR SELECT TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY audit_log_owner_append ON public.audit_log FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- AR. Rate limits & quotas
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.rate_limit_policies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  scope         text NOT NULL DEFAULT 'key',           -- key | user | route | ip
  match_target  text NOT NULL DEFAULT '*',             -- key id, route pattern, etc.
  window_sec    integer NOT NULL DEFAULT 60,
  limit_count   integer NOT NULL DEFAULT 60,
  burst         integer NOT NULL DEFAULT 0,
  action        text NOT NULL DEFAULT 'throttle',      -- throttle | reject | log
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rate_limit_policies_user_name_uq ON public.rate_limit_policies (user_id, name);
CREATE INDEX IF NOT EXISTS rate_limit_policies_scope_idx ON public.rate_limit_policies (user_id, scope, enabled);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limit_policies TO authenticated;
GRANT ALL ON public.rate_limit_policies TO service_role;
ALTER TABLE public.rate_limit_policies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY rate_limit_policies_owner ON public.rate_limit_policies FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS public.rate_limit_usage (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  policy_id    uuid REFERENCES public.rate_limit_policies(id) ON DELETE CASCADE,
  bucket_key   text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  rejected     integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rate_limit_usage_uq ON public.rate_limit_usage (user_id, policy_id, bucket_key, window_start);
CREATE INDEX IF NOT EXISTS rate_limit_usage_user_idx ON public.rate_limit_usage (user_id, window_start DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limit_usage TO authenticated;
GRANT ALL ON public.rate_limit_usage TO service_role;
ALTER TABLE public.rate_limit_usage ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY rate_limit_usage_owner ON public.rate_limit_usage FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- AS. Data residency & region pinning
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.region_policies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  default_region  text NOT NULL DEFAULT 'us-east-1',
  allowed_regions jsonb NOT NULL DEFAULT '["us-east-1","eu-west-1","ap-southeast-1"]',
  strict          boolean NOT NULL DEFAULT false,         -- if true, refuses cross-region replication
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.region_policies TO authenticated;
GRANT ALL ON public.region_policies TO service_role;
ALTER TABLE public.region_policies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY region_policies_owner ON public.region_policies FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS public.region_pins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  resource_type text NOT NULL,                         -- e.g. 'storage_object', 'export', 'audit_bundle'
  resource_id   text NOT NULL,
  region        text NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS region_pins_resource_uq ON public.region_pins (user_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS region_pins_region_idx ON public.region_pins (user_id, region);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.region_pins TO authenticated;
GRANT ALL ON public.region_pins TO service_role;
ALTER TABLE public.region_pins ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY region_pins_owner ON public.region_pins FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- AT. Digests — channels + schedules + quiet hours + send log
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.digest_channels (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind         text NOT NULL,                          -- slack | telegram | email | webhook
  label        text NOT NULL,
  target       text NOT NULL,                          -- webhook URL, chat id, email address
  secret_ref   text,                                   -- opaque ref to a stored secret (token/signing key)
  enabled      boolean NOT NULL DEFAULT true,
  quiet_start  text,                                   -- 'HH:MM' UTC, optional
  quiet_end    text,                                   -- 'HH:MM' UTC, optional
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS digest_channels_user_idx ON public.digest_channels (user_id, kind, enabled);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.digest_channels TO authenticated;
GRANT ALL ON public.digest_channels TO service_role;
ALTER TABLE public.digest_channels ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY digest_channels_owner ON public.digest_channels FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS public.digest_schedules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  channel_ids  jsonb NOT NULL DEFAULT '[]',
  cron         text NOT NULL,                          -- standard 5-field cron
  source       text NOT NULL DEFAULT 'inbox',          -- inbox | insights | jobs | custom
  filter       jsonb NOT NULL DEFAULT '{}',
  enabled      boolean NOT NULL DEFAULT true,
  last_run_at  timestamptz,
  next_run_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS digest_schedules_user_name_uq ON public.digest_schedules (user_id, name);
CREATE INDEX IF NOT EXISTS digest_schedules_due_idx ON public.digest_schedules (enabled, next_run_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.digest_schedules TO authenticated;
GRANT ALL ON public.digest_schedules TO service_role;
ALTER TABLE public.digest_schedules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY digest_schedules_owner ON public.digest_schedules FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- AU. Cross-entity search & saved searches
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.search_docs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  entity_type  text NOT NULL,                          -- 'inbox' | 'export' | 'workflow' | 'capability' | ...
  entity_id    text NOT NULL,
  title        text NOT NULL,
  body         text NOT NULL DEFAULT '',
  tags         jsonb NOT NULL DEFAULT '[]',
  metadata     jsonb NOT NULL DEFAULT '{}',
  tsv          tsvector GENERATED ALWAYS AS
                 (setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
                  setweight(to_tsvector('simple', coalesce(body,  '')), 'B')) STORED,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS search_docs_entity_uq ON public.search_docs (user_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS search_docs_tsv_idx ON public.search_docs USING GIN (tsv);
CREATE INDEX IF NOT EXISTS search_docs_user_idx ON public.search_docs (user_id, entity_type, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_docs TO authenticated;
GRANT ALL ON public.search_docs TO service_role;
ALTER TABLE public.search_docs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY search_docs_owner ON public.search_docs FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS public.search_saved (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  query       text NOT NULL,
  filters     jsonb NOT NULL DEFAULT '{}',
  pinned      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS search_saved_user_name_uq ON public.search_saved (user_id, name);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_saved TO authenticated;
GRANT ALL ON public.search_saved TO service_role;
ALTER TABLE public.search_saved ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY search_saved_owner ON public.search_saved FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- AV. Workflow DAG engine — definitions + runs
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.workflows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  trigger      jsonb NOT NULL DEFAULT '{"kind":"manual"}',     -- {kind:'manual'|'cron'|'event'|'webhook', ...}
  nodes        jsonb NOT NULL DEFAULT '[]',                    -- [{id, kind, capability?, with?, next:[ids], retries?}]
  enabled      boolean NOT NULL DEFAULT true,
  version      integer NOT NULL DEFAULT 1,
  last_run_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS workflows_user_name_uq ON public.workflows (user_id, name);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflows TO authenticated;
GRANT ALL ON public.workflows TO service_role;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY workflows_owner ON public.workflows FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workflow_id  uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  trigger      jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'queued',                 -- queued | running | succeeded | failed | cancelled
  input        jsonb NOT NULL DEFAULT '{}',
  output       jsonb,
  node_log     jsonb NOT NULL DEFAULT '[]',                    -- [{nodeId, status, startedAt, finishedAt, output?, error?}]
  error        text,
  started_at   timestamptz,
  finished_at  timestamptz,
  duration_ms  integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_runs_workflow_idx ON public.workflow_runs (workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workflow_runs_user_status_idx ON public.workflow_runs (user_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_runs TO authenticated;
GRANT ALL ON public.workflow_runs TO service_role;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY workflow_runs_owner ON public.workflow_runs FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- AX. Entitlements & plan enforcement
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.entitlement_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  feature     text NOT NULL,                          -- canonical feature key e.g. 'workflows.max_nodes'
  value       jsonb NOT NULL,                         -- boolean | number | string | object
  reason      text,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS entitlement_overrides_user_feature_uq ON public.entitlement_overrides (user_id, feature);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.entitlement_overrides TO authenticated;
GRANT ALL ON public.entitlement_overrides TO service_role;
ALTER TABLE public.entitlement_overrides ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY entitlement_overrides_owner ON public.entitlement_overrides FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
