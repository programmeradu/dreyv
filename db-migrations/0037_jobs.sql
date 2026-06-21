-- Phase 21 — Jobs & Scheduling (Pillar AE).
--
-- A user-facing async runner that invokes registered public-API capabilities
-- on a schedule (one-shot at a future timestamp, or recurring every N
-- seconds). Runs are persisted with full status + result/error capture so
-- callers can replay or audit. Quota and minimum interval are enforced in
-- app code against `users.tier`.
--
-- Neon Postgres — no RLS, no PostgREST grants required (auth handled in
-- the Next.js API layer).

CREATE TABLE IF NOT EXISTS public.public_api_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key_id          uuid NOT NULL REFERENCES public.public_api_keys(id) ON DELETE CASCADE,
  label           text NOT NULL,
  capability_id   text NOT NULL,                           -- e.g. 'portfolio.holdings'
  input           jsonb NOT NULL DEFAULT '{}'::jsonb,      -- payload passed to capability
  kind            text NOT NULL DEFAULT 'recurring',       -- 'recurring' | 'one_shot'
  interval_seconds integer,                                -- required when kind='recurring' (>=60)
  next_run_at     timestamptz NOT NULL,                    -- when the runner should pick it up
  max_retries     integer NOT NULL DEFAULT 3,
  status          text NOT NULL DEFAULT 'active',          -- 'active' | 'paused' | 'cancelled' | 'completed'
  last_run_at     timestamptz,
  last_status     text,                                    -- 'ok' | 'failed' | null
  run_count       integer NOT NULL DEFAULT 0,
  fail_count      integer NOT NULL DEFAULT 0,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_api_jobs_user_idx
  ON public.public_api_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS public_api_jobs_key_idx
  ON public.public_api_jobs(key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS public_api_jobs_due_idx
  ON public.public_api_jobs(status, next_run_at)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.public_api_job_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid NOT NULL REFERENCES public.public_api_jobs(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'queued',          -- queued | running | ok | failed | cancelled
  attempt         integer NOT NULL DEFAULT 1,
  started_at      timestamptz,
  finished_at     timestamptz,
  duration_ms     integer,
  result          jsonb,                                   -- truncated capability output
  error_code      text,
  error_message   text,
  triggered_by    text NOT NULL DEFAULT 'schedule',        -- schedule | manual | retry
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_api_job_runs_job_idx
  ON public.public_api_job_runs(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS public_api_job_runs_user_idx
  ON public.public_api_job_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS public_api_job_runs_status_idx
  ON public.public_api_job_runs(status, created_at DESC);
