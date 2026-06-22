-- Phase AN/AO — SLA / Status pages / Schema registry / Contracts (production backfill)
-- These tables are defined in src/db/schema.ts but were never migrated to Neon.

DO $bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $bootstrap$;

-- ─── Pillar AN — SLA & Status pages ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.public_api_status_pages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  slug         text NOT NULL,
  title        text NOT NULL,
  description  text,
  branding     jsonb NOT NULL DEFAULT '{}'::jsonb,
  components   jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_public    boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS public_api_status_pages_slug_uq ON public.public_api_status_pages (slug);
CREATE INDEX IF NOT EXISTS public_api_status_pages_user_idx ON public.public_api_status_pages (user_id);

CREATE TABLE IF NOT EXISTS public.public_api_status_incidents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id       uuid NOT NULL REFERENCES public.public_api_status_pages(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title         text NOT NULL,
  status        text NOT NULL DEFAULT 'investigating',
  severity      text NOT NULL DEFAULT 'minor',
  impact        text NOT NULL DEFAULT 'none',
  component_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_api_status_incidents_page_idx ON public.public_api_status_incidents (page_id, started_at);

CREATE TABLE IF NOT EXISTS public.public_api_status_incident_updates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.public_api_status_incidents(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status      text NOT NULL,
  body        text NOT NULL,
  posted_at   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_api_status_incident_updates_incident_idx ON public.public_api_status_incident_updates (incident_id, posted_at);

CREATE TABLE IF NOT EXISTS public.public_api_status_maintenance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id         uuid NOT NULL REFERENCES public.public_api_status_pages(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title           text NOT NULL,
  body            text,
  component_ids   jsonb NOT NULL DEFAULT '[]'::jsonb,
  scheduled_start timestamptz NOT NULL,
  scheduled_end   timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'scheduled',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_api_status_maintenance_page_idx ON public.public_api_status_maintenance (page_id, scheduled_start);

CREATE TABLE IF NOT EXISTS public.public_api_status_subscribers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id         uuid NOT NULL REFERENCES public.public_api_status_pages(id) ON DELETE CASCADE,
  channel         text NOT NULL,
  target          text NOT NULL,
  component_ids   jsonb NOT NULL DEFAULT '[]'::jsonb,
  confirm_token   text NOT NULL,
  confirmed_at    timestamptz,
  unsubscribed_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS public_api_status_subscribers_uq ON public.public_api_status_subscribers (page_id, channel, target);

CREATE TABLE IF NOT EXISTS public.public_api_sla_targets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES public.users(id) ON DELETE CASCADE,
  tier           text,
  component_key  text NOT NULL,
  uptime_target  numeric(6,4) NOT NULL,
  latency_p95_ms integer NOT NULL,
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_to       timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_api_sla_targets_user_idx ON public.public_api_sla_targets (user_id, component_key);
CREATE INDEX IF NOT EXISTS public_api_sla_targets_tier_idx ON public.public_api_sla_targets (tier, component_key);

CREATE TABLE IF NOT EXISTS public.public_api_sla_credits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  target       jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed     jsonb NOT NULL DEFAULT '{}'::jsonb,
  credit_pct   numeric(6,4) NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'pending',
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS public_api_sla_credits_user_period_uq ON public.public_api_sla_credits (user_id, period_month);

-- ─── Pillar AO — Data Contracts & Schema Registry ────────────────────
CREATE TABLE IF NOT EXISTS public.public_api_schemas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  namespace      text NOT NULL DEFAULT 'default',
  name           text NOT NULL,
  description    text,
  latest_version text,
  deprecated_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS public_api_schemas_user_ns_name_uq ON public.public_api_schemas (user_id, namespace, name);
CREATE INDEX IF NOT EXISTS public_api_schemas_user_idx ON public.public_api_schemas (user_id);

CREATE TABLE IF NOT EXISTS public.public_api_schema_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_id        uuid NOT NULL REFERENCES public.public_api_schemas(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version          text NOT NULL,
  json_schema      jsonb NOT NULL,
  schema_hash      text NOT NULL,
  changelog        text,
  compatibility    text NOT NULL DEFAULT 'unknown',
  breaking_changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  yanked_at        timestamptz,
  yank_reason      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS public_api_schema_versions_schema_version_uq ON public.public_api_schema_versions (schema_id, version);
CREATE INDEX IF NOT EXISTS public_api_schema_versions_schema_idx ON public.public_api_schema_versions (schema_id, created_at);

CREATE TABLE IF NOT EXISTS public.public_api_contracts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text,
  subject_type   text NOT NULL,
  subject        text NOT NULL,
  schema_id      uuid NOT NULL REFERENCES public.public_api_schemas(id) ON DELETE RESTRICT,
  schema_version text NOT NULL,
  mode           text NOT NULL DEFAULT 'validate',
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS public_api_contracts_user_name_uq ON public.public_api_contracts (user_id, name);
CREATE INDEX IF NOT EXISTS public_api_contracts_subject_idx ON public.public_api_contracts (user_id, subject_type, subject);

CREATE TABLE IF NOT EXISTS public.public_api_contract_violations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     uuid NOT NULL REFERENCES public.public_api_contracts(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject         text NOT NULL,
  payload_excerpt jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors          jsonb NOT NULL DEFAULT '[]'::jsonb,
  severity        text NOT NULL DEFAULT 'error',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_api_contract_violations_contract_idx ON public.public_api_contract_violations (contract_id, created_at);
CREATE INDEX IF NOT EXISTS public_api_contract_violations_user_idx ON public.public_api_contract_violations (user_id, created_at);

-- Grants (Neon-safe; roles bootstrapped above)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.public_api_status_pages,
  public.public_api_status_incidents,
  public.public_api_status_incident_updates,
  public.public_api_status_maintenance,
  public.public_api_status_subscribers,
  public.public_api_sla_targets,
  public.public_api_sla_credits,
  public.public_api_schemas,
  public.public_api_schema_versions,
  public.public_api_contracts,
  public.public_api_contract_violations
TO authenticated;

GRANT ALL ON
  public.public_api_status_pages,
  public.public_api_status_incidents,
  public.public_api_status_incident_updates,
  public.public_api_status_maintenance,
  public.public_api_status_subscribers,
  public.public_api_sla_targets,
  public.public_api_sla_credits,
  public.public_api_schemas,
  public.public_api_schema_versions,
  public.public_api_contracts,
  public.public_api_contract_violations
TO service_role;

GRANT SELECT ON public.public_api_status_pages, public.public_api_status_incidents, public.public_api_status_incident_updates, public.public_api_status_maintenance TO anon;
