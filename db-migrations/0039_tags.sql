-- Phase 23 — Tags, Labels & Annotations (Pillar AG).
--
-- Cross-cutting labeling: callers define their own tags (name, color,
-- description) and attach them to any entity in the system by an opaque
-- (entity_type, entity_id) pair plus an optional free-form note. Entity
-- ids are stored as text so the same tag table can label uuids, numeric
-- ids, addresses, tx hashes, capability ids, etc. uniformly.
--
-- Neon Postgres — no RLS (auth handled in the Next.js API layer).

CREATE TABLE IF NOT EXISTS public.public_api_tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key_id      uuid NOT NULL REFERENCES public.public_api_keys(id) ON DELETE CASCADE,
  name        text NOT NULL,                          -- normalized (lower, trimmed)
  display     text NOT NULL,                          -- original casing
  color       text NOT NULL DEFAULT 'violet',         -- preset palette name
  description text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS public_api_tags_user_name_uq
  ON public.public_api_tags(user_id, name);
CREATE INDEX IF NOT EXISTS public_api_tags_user_idx
  ON public.public_api_tags(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.public_api_tag_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL REFERENCES public.public_api_tags(id) ON DELETE CASCADE,
  entity_type text NOT NULL,            -- address|tx|capability|job|run|artifact|proposal|watcher|monitor|export|notification|custom
  entity_id   text NOT NULL,            -- opaque (uuid | numeric string | address | tx hash | capability id | freeform)
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS public_api_tag_links_uq
  ON public.public_api_tag_links(tag_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS public_api_tag_links_user_idx
  ON public.public_api_tag_links(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS public_api_tag_links_entity_idx
  ON public.public_api_tag_links(user_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS public_api_tag_links_tag_idx
  ON public.public_api_tag_links(tag_id, created_at DESC);
