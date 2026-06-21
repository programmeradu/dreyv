-- Phase 18 — Storage & Artifacts (Pillar Z).
-- Backs uploaded artifacts in R2 (or any S3-compat) and tracks pointers in
-- public_api_artifacts. RLS not used (Neon Postgres). Per-user quota is
-- enforced in app code against `users.tier`.

CREATE TABLE IF NOT EXISTS public.public_api_artifacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key_id        uuid NOT NULL REFERENCES public.public_api_keys(id) ON DELETE CASCADE,
  storage_key   text NOT NULL,                       -- R2 object key (dreyv/artifacts/<user>/<id>/<filename>)
  filename      text NOT NULL,
  mime          text NOT NULL DEFAULT 'application/octet-stream',
  bytes         integer NOT NULL,
  sha256        text NOT NULL,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- caller-supplied tags
  visibility    text NOT NULL DEFAULT 'private',     -- private | unlisted
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS public_api_artifacts_user_idx
  ON public.public_api_artifacts(user_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS public_api_artifacts_key_idx
  ON public.public_api_artifacts(key_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS public_api_artifacts_sha_idx
  ON public.public_api_artifacts(user_id, sha256);
