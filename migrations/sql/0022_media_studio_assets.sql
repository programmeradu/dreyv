-- Phase: Media Studio — Dreyv internal brand/content studio
--
-- Stores generated marketing/social artifacts (copy variants, infographic
-- specs, image/video metadata) produced by team members at /app/studio/media.
--
-- Binary payloads (PNG/JPG/MP4) live in Cloudflare R2 under `storage_key`;
-- this table holds the metadata + structured spec only.
--
-- Access is enforced server-side via the SIWS session cookie + an internal
-- team role check — we do not rely on Postgres RLS for this table because
-- our app uses Neon directly (no Supabase Auth on the SQL connection).

CREATE TABLE IF NOT EXISTS media_studio_assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL,                    -- post | infographic | announcement | video
  channel       TEXT,                             -- x | linkedin | instagram | generic
  title         TEXT,
  prompt        TEXT NOT NULL,
  spec          JSONB NOT NULL DEFAULT '{}'::jsonb,
  storage_key   TEXT,                             -- R2 object key (null for text-only)
  mime_type     TEXT,
  width         INTEGER,
  height        INTEGER,
  duration_ms   INTEGER,
  status        TEXT NOT NULL DEFAULT 'ready',    -- generating | ready | failed
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_studio_user_idx
  ON media_studio_assets (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS media_studio_kind_idx
  ON media_studio_assets (kind, created_at DESC);
