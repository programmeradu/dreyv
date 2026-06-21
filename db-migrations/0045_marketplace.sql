-- Phase 29 — Marketplace & Catalog (Pillar AM)
--
-- Five tables that together form the public-facing capability/agent/template
-- marketplace: a publisher identity row per workspace, listing definitions
-- with immutable version history, per-user installs, and ratings/reviews.

CREATE TABLE IF NOT EXISTS public.public_api_publishers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  slug             text NOT NULL,
  display_name     text NOT NULL,
  website          text,
  support_email    text,
  description      text,
  logo_url         text,
  verified         boolean NOT NULL DEFAULT false,
  verification_at  timestamptz,
  payouts_account  text,                              -- opaque billing-provider customer ref
  metadata         jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS public_api_publishers_user_uq
  ON public.public_api_publishers (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS public_api_publishers_slug_uq
  ON public.public_api_publishers (slug);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_publishers TO authenticated;
GRANT ALL ON public.public_api_publishers TO service_role;
GRANT SELECT ON public.public_api_publishers TO anon;  -- public catalog browse

ALTER TABLE public.public_api_publishers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY public_api_publishers_owner ON public.public_api_publishers
    FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY public_api_publishers_public_read ON public.public_api_publishers
    FOR SELECT TO anon
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS public.public_api_listings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id       uuid NOT NULL REFERENCES public.public_api_publishers(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  slug               text NOT NULL,
  title              text NOT NULL,
  summary            text NOT NULL,
  long_description   text,
  category           text NOT NULL DEFAULT 'general',
  kind               text NOT NULL DEFAULT 'capability', -- capability | template | agent | dataset | workflow
  pricing_model      text NOT NULL DEFAULT 'free',       -- free | one_time | subscription | usage
  price_minor        integer NOT NULL DEFAULT 0,         -- in minor units of currency
  currency           text NOT NULL DEFAULT 'USD',
  status             text NOT NULL DEFAULT 'draft',      -- draft | pending | published | suspended | archived
  visibility         text NOT NULL DEFAULT 'public',     -- public | unlisted | private
  tags               jsonb NOT NULL DEFAULT '[]',
  manifest           jsonb NOT NULL DEFAULT '{}',        -- capability bindings / template body / agent spec
  current_version    text NOT NULL DEFAULT '0.1.0',
  install_count      integer NOT NULL DEFAULT 0,
  rating_avg         numeric(3, 2) NOT NULL DEFAULT 0,
  rating_count       integer NOT NULL DEFAULT 0,
  published_at       timestamptz,
  unpublished_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS public_api_listings_publisher_slug_uq
  ON public.public_api_listings (publisher_id, slug);
CREATE INDEX IF NOT EXISTS public_api_listings_user_idx
  ON public.public_api_listings (user_id, created_at);
CREATE INDEX IF NOT EXISTS public_api_listings_status_idx
  ON public.public_api_listings (status, visibility, published_at);
CREATE INDEX IF NOT EXISTS public_api_listings_category_idx
  ON public.public_api_listings (category, kind, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_listings TO authenticated;
GRANT ALL ON public.public_api_listings TO service_role;
GRANT SELECT ON public.public_api_listings TO anon;

ALTER TABLE public.public_api_listings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY public_api_listings_owner ON public.public_api_listings
    FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY public_api_listings_public_read ON public.public_api_listings
    FOR SELECT TO authenticated
    USING (status = 'published' AND visibility IN ('public', 'unlisted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY public_api_listings_anon_read ON public.public_api_listings
    FOR SELECT TO anon
    USING (status = 'published' AND visibility = 'public');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS public.public_api_listing_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES public.public_api_listings(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version       text NOT NULL,
  changelog     text,
  manifest      jsonb NOT NULL DEFAULT '{}',
  manifest_hash text NOT NULL,
  yanked_at     timestamptz,
  yank_reason   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS public_api_listing_versions_listing_version_uq
  ON public.public_api_listing_versions (listing_id, version);
CREATE INDEX IF NOT EXISTS public_api_listing_versions_listing_idx
  ON public.public_api_listing_versions (listing_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_listing_versions TO authenticated;
GRANT ALL ON public.public_api_listing_versions TO service_role;
GRANT SELECT ON public.public_api_listing_versions TO anon;

ALTER TABLE public.public_api_listing_versions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY public_api_listing_versions_owner ON public.public_api_listing_versions
    FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY public_api_listing_versions_public_read ON public.public_api_listing_versions
    FOR SELECT TO anon
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS public.public_api_listing_installs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      uuid NOT NULL REFERENCES public.public_api_listings(id) ON DELETE CASCADE,
  version_id      uuid REFERENCES public.public_api_listing_versions(id) ON DELETE SET NULL,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key_id          uuid REFERENCES public.public_api_keys(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'active',     -- active | uninstalled | suspended
  pricing_model   text NOT NULL DEFAULT 'free',
  price_minor     integer NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'USD',
  billing_ref     text,                               -- invoice id / subscription id
  config          jsonb NOT NULL DEFAULT '{}',
  installed_at    timestamptz NOT NULL DEFAULT now(),
  uninstalled_at  timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS public_api_listing_installs_user_listing_uq
  ON public.public_api_listing_installs (user_id, listing_id);
CREATE INDEX IF NOT EXISTS public_api_listing_installs_listing_idx
  ON public.public_api_listing_installs (listing_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_listing_installs TO authenticated;
GRANT ALL ON public.public_api_listing_installs TO service_role;

ALTER TABLE public.public_api_listing_installs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY public_api_listing_installs_owner ON public.public_api_listing_installs
    FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS public.public_api_listing_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES public.public_api_listings(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rating        integer NOT NULL,                    -- 1..5, validated in trigger
  title         text,
  body          text,
  hidden_at     timestamptz,
  hidden_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS public_api_listing_reviews_user_listing_uq
  ON public.public_api_listing_reviews (user_id, listing_id);
CREATE INDEX IF NOT EXISTS public_api_listing_reviews_listing_idx
  ON public.public_api_listing_reviews (listing_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_api_listing_reviews TO authenticated;
GRANT ALL ON public.public_api_listing_reviews TO service_role;
GRANT SELECT ON public.public_api_listing_reviews TO anon;

ALTER TABLE public.public_api_listing_reviews ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY public_api_listing_reviews_owner ON public.public_api_listing_reviews
    FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY public_api_listing_reviews_public_read ON public.public_api_listing_reviews
    FOR SELECT TO anon
    USING (hidden_at IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Validation trigger: rating in [1..5], pricing_model values, status transitions handled in code.
CREATE OR REPLACE FUNCTION public.public_api_listing_reviews_validate()
RETURNS trigger AS $$
BEGIN
  IF NEW.rating < 1 OR NEW.rating > 5 THEN
    RAISE EXCEPTION 'rating must be between 1 and 5 (got %)', NEW.rating;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DO $$ BEGIN
  CREATE TRIGGER public_api_listing_reviews_validate_trg
    BEFORE INSERT OR UPDATE ON public.public_api_listing_reviews
    FOR EACH ROW EXECUTE FUNCTION public.public_api_listing_reviews_validate();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
