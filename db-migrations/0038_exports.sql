-- Phase 22 — Exports & Reports (Pillar AF).
--
-- Per-tenant data exports across the user's own audit log, usage metering,
-- webhook deliveries, notifications, watchers, monitors, proposals, jobs,
-- job runs and storage artifacts. Generation is synchronous (queries are
-- already userId-scoped and capped by row/byte limits). The serialized
-- body (CSV or JSONL) is stored inline as `bytea` so a follow-up
-- `exports.download` can return it without re-querying source tables.
--
-- Neon Postgres — no RLS (auth handled in the Next.js API layer).

CREATE TABLE IF NOT EXISTS public.public_api_exports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key_id        uuid NOT NULL REFERENCES public.public_api_keys(id) ON DELETE CASCADE,
  label         text NOT NULL,
  source        text NOT NULL,                          -- audit|usage|deliveries|notifications|watchers|monitors|proposals|jobs|runs|artifacts
  format        text NOT NULL DEFAULT 'csv',            -- csv | jsonl
  filters       jsonb NOT NULL DEFAULT '{}'::jsonb,     -- { since, until, status, capabilityId, ... }
  row_count     integer NOT NULL DEFAULT 0,
  byte_size     integer NOT NULL DEFAULT 0,
  sha256        text NOT NULL DEFAULT '',
  truncated     boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'pending',        -- pending | completed | failed | purged
  error_code    text,
  error_message text,
  body          bytea,                                  -- inline payload, null after purge
  expires_at    timestamptz NOT NULL,                   -- auto-purge target
  created_at    timestamptz NOT NULL DEFAULT now(),
  purged_at     timestamptz
);

CREATE INDEX IF NOT EXISTS public_api_exports_user_idx
  ON public.public_api_exports(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS public_api_exports_key_idx
  ON public.public_api_exports(key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS public_api_exports_source_idx
  ON public.public_api_exports(user_id, source, created_at DESC);
CREATE INDEX IF NOT EXISTS public_api_exports_status_idx
  ON public.public_api_exports(status, expires_at);
