
-- Phase 30 / Pillar AN — SLA & Status pages
-- Public status pages, incidents, maintenance windows, subscribers, SLA targets and credits.

CREATE TABLE IF NOT EXISTS public.public_api_status_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  description text,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_public boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS public_api_status_pages_slug_uq ON public.public_api_status_pages(slug);
CREATE INDEX IF NOT EXISTS public_api_status_pages_user_idx ON public.public_api_status_pages(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_status_pages TO authenticated;
GRANT ALL ON public.public_api_status_pages TO service_role;
GRANT SELECT ON public.public_api_status_pages TO anon;

ALTER TABLE public.public_api_status_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own status pages" ON public.public_api_status_pages
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "public can read published pages" ON public.public_api_status_pages
  FOR SELECT TO anon USING (is_public = true AND published_at IS NOT NULL);
CREATE POLICY "service role full access pages" ON public.public_api_status_pages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.public_api_status_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.public_api_status_pages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'investigating',
  severity text NOT NULL DEFAULT 'minor',
  impact text NOT NULL DEFAULT 'none',
  component_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_api_status_incidents_page_idx ON public.public_api_status_incidents(page_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_status_incidents TO authenticated;
GRANT ALL ON public.public_api_status_incidents TO service_role;
GRANT SELECT ON public.public_api_status_incidents TO anon;

ALTER TABLE public.public_api_status_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own incidents" ON public.public_api_status_incidents
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "public can read incidents on published pages" ON public.public_api_status_incidents
  FOR SELECT TO anon USING (EXISTS (
    SELECT 1 FROM public.public_api_status_pages p
    WHERE p.id = page_id AND p.is_public = true AND p.published_at IS NOT NULL
  ));
CREATE POLICY "service role full access incidents" ON public.public_api_status_incidents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.public_api_status_incident_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.public_api_status_incidents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL,
  body text NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_api_status_incident_updates_incident_idx ON public.public_api_status_incident_updates(incident_id, posted_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_status_incident_updates TO authenticated;
GRANT ALL ON public.public_api_status_incident_updates TO service_role;
GRANT SELECT ON public.public_api_status_incident_updates TO anon;

ALTER TABLE public.public_api_status_incident_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own incident updates" ON public.public_api_status_incident_updates
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "public reads updates on published pages" ON public.public_api_status_incident_updates
  FOR SELECT TO anon USING (EXISTS (
    SELECT 1 FROM public.public_api_status_incidents i
    JOIN public.public_api_status_pages p ON p.id = i.page_id
    WHERE i.id = incident_id AND p.is_public = true AND p.published_at IS NOT NULL
  ));
CREATE POLICY "service role full access incident updates" ON public.public_api_status_incident_updates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.public_api_status_maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.public_api_status_pages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text,
  component_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_api_status_maintenance_page_idx ON public.public_api_status_maintenance(page_id, scheduled_start DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_status_maintenance TO authenticated;
GRANT ALL ON public.public_api_status_maintenance TO service_role;
GRANT SELECT ON public.public_api_status_maintenance TO anon;

ALTER TABLE public.public_api_status_maintenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own maintenance" ON public.public_api_status_maintenance
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "public reads maintenance on published pages" ON public.public_api_status_maintenance
  FOR SELECT TO anon USING (EXISTS (
    SELECT 1 FROM public.public_api_status_pages p
    WHERE p.id = page_id AND p.is_public = true AND p.published_at IS NOT NULL
  ));
CREATE POLICY "service role full access maintenance" ON public.public_api_status_maintenance
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.public_api_status_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.public_api_status_pages(id) ON DELETE CASCADE,
  channel text NOT NULL,
  target text NOT NULL,
  component_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  confirm_token text NOT NULL,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS public_api_status_subscribers_uq ON public.public_api_status_subscribers(page_id, channel, target);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_status_subscribers TO authenticated;
GRANT ALL ON public.public_api_status_subscribers TO service_role;

ALTER TABLE public.public_api_status_subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "page owner manages subscribers" ON public.public_api_status_subscribers
  FOR ALL TO authenticated USING (EXISTS (
    SELECT 1 FROM public.public_api_status_pages p WHERE p.id = page_id AND p.user_id = auth.uid()
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.public_api_status_pages p WHERE p.id = page_id AND p.user_id = auth.uid()
  ));
CREATE POLICY "service role full access subscribers" ON public.public_api_status_subscribers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.public_api_sla_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  tier text,
  component_key text NOT NULL,
  uptime_target numeric(6,4) NOT NULL,
  latency_p95_ms integer NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_api_sla_targets_user_idx ON public.public_api_sla_targets(user_id, component_key);
CREATE INDEX IF NOT EXISTS public_api_sla_targets_tier_idx ON public.public_api_sla_targets(tier, component_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_sla_targets TO authenticated;
GRANT ALL ON public.public_api_sla_targets TO service_role;

ALTER TABLE public.public_api_sla_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own or default sla targets" ON public.public_api_sla_targets
  FOR SELECT TO authenticated USING (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY "service role full access sla targets" ON public.public_api_sla_targets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.public_api_sla_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period_month text NOT NULL,
  target jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed jsonb NOT NULL DEFAULT '{}'::jsonb,
  credit_pct numeric(6,4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS public_api_sla_credits_user_period_uq ON public.public_api_sla_credits(user_id, period_month);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_sla_credits TO authenticated;
GRANT ALL ON public.public_api_sla_credits TO service_role;

ALTER TABLE public.public_api_sla_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own sla credits" ON public.public_api_sla_credits
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "service role full access sla credits" ON public.public_api_sla_credits
  FOR ALL TO service_role USING (true) WITH CHECK (true);
