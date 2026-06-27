ALTER TABLE public.studio_video_jobs
  ADD COLUMN IF NOT EXISTS shot_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS final_key text;