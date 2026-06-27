-- 0056_studio_video_jobs_r2_keys.sql
-- Add R2 object key columns so we can re-presign URLs on demand.
ALTER TABLE studio_video_jobs
  ADD COLUMN IF NOT EXISTS shot_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS final_key text;
