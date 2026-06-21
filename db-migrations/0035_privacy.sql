-- Phase 17 — Privacy & Data Rights (DSAR / GDPR) — Pillar Y.
-- Two tables: data-subject requests (export | delete | rectify | restrict)
-- and per-user consent records (telemetry, marketing, ai_training, …).
-- Neon Postgres — no service_role / authenticated roles, RLS not used.

CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind          text NOT NULL,                    -- export | delete | rectify | restrict
  status        text NOT NULL DEFAULT 'pending',  -- pending | in_progress | fulfilled | rejected | cancelled
  reason        text,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  due_by        timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  fulfilled_at  timestamptz,
  artifact_sha  text,                              -- sha-256 of export artifact when kind=export
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS privacy_requests_user_idx
  ON public.privacy_requests(user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS privacy_requests_status_idx
  ON public.privacy_requests(status, due_by);

CREATE TABLE IF NOT EXISTS public.privacy_consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  topic       text NOT NULL,           -- telemetry | marketing | ai_training | third_party_sharing | session_replay
  granted     boolean NOT NULL,
  source      text NOT NULL DEFAULT 'api',  -- api | ui | import
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, topic)
);

CREATE INDEX IF NOT EXISTS privacy_consents_user_idx
  ON public.privacy_consents(user_id);
