-- 0055_studio_video_jobs.sql
-- Background render jobs for the Dreyv Video Studio (fal.ai pipeline).
-- One row per "Render full ad" click. Pack JSON captured at submission
-- so re-renders use the exact same hook/shot list.

CREATE TABLE IF NOT EXISTS studio_video_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status          text NOT NULL DEFAULT 'queued', -- queued | rendering_shots | stitching | done | failed
  pack            jsonb NOT NULL,
  model           text NOT NULL DEFAULT 'fal-ai/veo3/fast',
  shots_total     integer NOT NULL DEFAULT 0,
  shots_done      integer NOT NULL DEFAULT 0,
  shot_urls       jsonb NOT NULL DEFAULT '[]'::jsonb,
  final_url       text,
  duration_sec    integer,
  cost_usd_minor  integer,
  error           text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS studio_video_jobs_created_idx
  ON studio_video_jobs (created_at DESC);
