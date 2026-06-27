-- 0053 — Colosseum Copilot response cache
--
-- Backs the "Builders in this space" widget on /atlas/tokens and
-- /atlas/protocols. We hit copilot.colosseum.com sparingly and serve
-- cached results for 24h (configurable per row via expires_at).
--
-- key shape: lower(trim(query))  -- normalized search term

CREATE TABLE IF NOT EXISTS public.colosseum_cache (
  key         text PRIMARY KEY,
  query       text NOT NULL,
  payload     jsonb NOT NULL,
  source      text NOT NULL DEFAULT 'copilot.search',
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS colosseum_cache_expires_idx
  ON public.colosseum_cache (expires_at);

GRANT SELECT ON public.colosseum_cache TO anon, authenticated;
GRANT ALL ON public.colosseum_cache TO service_role;

ALTER TABLE public.colosseum_cache ENABLE ROW LEVEL SECURITY;

-- Cache is non-sensitive aggregate data; reads are public, writes server-only.
CREATE POLICY "colosseum_cache_read_all"
  ON public.colosseum_cache FOR SELECT
  TO anon, authenticated
  USING (true);
