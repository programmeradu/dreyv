
-- Phase 31 / Pillar AO — Data Contracts & Schema Registry

CREATE TABLE IF NOT EXISTS public.public_api_schemas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  namespace text NOT NULL DEFAULT 'default',
  name text NOT NULL,
  description text,
  latest_version text,
  deprecated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS public_api_schemas_user_ns_name_uq
  ON public.public_api_schemas(user_id, namespace, name);
CREATE INDEX IF NOT EXISTS public_api_schemas_user_idx ON public.public_api_schemas(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_schemas TO authenticated;
GRANT ALL ON public.public_api_schemas TO service_role;

ALTER TABLE public.public_api_schemas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own schemas" ON public.public_api_schemas
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "service role full access schemas" ON public.public_api_schemas
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.public_api_schema_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_id uuid NOT NULL REFERENCES public.public_api_schemas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  version text NOT NULL,
  json_schema jsonb NOT NULL,
  schema_hash text NOT NULL,
  changelog text,
  compatibility text NOT NULL DEFAULT 'unknown',
  breaking_changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  yanked_at timestamptz,
  yank_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS public_api_schema_versions_schema_version_uq
  ON public.public_api_schema_versions(schema_id, version);
CREATE INDEX IF NOT EXISTS public_api_schema_versions_schema_idx
  ON public.public_api_schema_versions(schema_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_schema_versions TO authenticated;
GRANT ALL ON public.public_api_schema_versions TO service_role;

ALTER TABLE public.public_api_schema_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own schema versions" ON public.public_api_schema_versions
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "service role full access schema versions" ON public.public_api_schema_versions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.public_api_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  subject_type text NOT NULL,
  subject text NOT NULL,
  schema_id uuid NOT NULL REFERENCES public.public_api_schemas(id) ON DELETE RESTRICT,
  schema_version text NOT NULL,
  mode text NOT NULL DEFAULT 'validate',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS public_api_contracts_user_name_uq
  ON public.public_api_contracts(user_id, name);
CREATE INDEX IF NOT EXISTS public_api_contracts_subject_idx
  ON public.public_api_contracts(user_id, subject_type, subject) WHERE active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_contracts TO authenticated;
GRANT ALL ON public.public_api_contracts TO service_role;

ALTER TABLE public.public_api_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own contracts" ON public.public_api_contracts
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "service role full access contracts" ON public.public_api_contracts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.public_api_contract_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.public_api_contracts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  subject text NOT NULL,
  payload_excerpt jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  severity text NOT NULL DEFAULT 'error',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_api_contract_violations_contract_idx
  ON public.public_api_contract_violations(contract_id, created_at DESC);
CREATE INDEX IF NOT EXISTS public_api_contract_violations_user_idx
  ON public.public_api_contract_violations(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_contract_violations TO authenticated;
GRANT ALL ON public.public_api_contract_violations TO service_role;

ALTER TABLE public.public_api_contract_violations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads own violations" ON public.public_api_contract_violations
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "owner inserts own violations" ON public.public_api_contract_violations
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner deletes own violations" ON public.public_api_contract_violations
  FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "service role full access violations" ON public.public_api_contract_violations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
