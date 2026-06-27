CREATE TABLE IF NOT EXISTS public.studio_video_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status          text NOT NULL DEFAULT 'queued',
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.studio_video_jobs TO authenticated;
GRANT ALL ON public.studio_video_jobs TO service_role;

ALTER TABLE public.studio_video_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages all jobs"
  ON public.studio_video_jobs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "owner reads own jobs"
  ON public.studio_video_jobs FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

CREATE INDEX IF NOT EXISTS studio_video_jobs_created_idx
  ON public.studio_video_jobs (created_at DESC);