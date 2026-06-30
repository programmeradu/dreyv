-- TikTok performance cache for the Video Studio intelligence loop.
-- Pulled via the TikTok connector and read by the Direction Generator + Hook
-- Foundry so each new pack is informed by what's actually working on the
-- dreyv account, not by generic templates.

CREATE TABLE IF NOT EXISTS public.studio_video_performance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      text NOT NULL,                  -- TikTok open_id (or "default" when single-account)
  video_id        text NOT NULL,                  -- TikTok video id
  title           text,
  caption         text,
  posted_at       timestamptz,
  duration_sec    integer,
  view_count      bigint NOT NULL DEFAULT 0,
  like_count      bigint NOT NULL DEFAULT 0,
  comment_count   bigint NOT NULL DEFAULT 0,
  share_count     bigint NOT NULL DEFAULT 0,
  avg_watch_sec   numeric(8,2),
  full_watch_rate numeric(5,4),                   -- 0..1
  cover_url       text,
  share_url       text,
  -- Optional: which dreyv-studio job produced this video, if we ever auto-post.
  job_id          uuid,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_studio_video_perf_account_posted
  ON public.studio_video_performance (account_id, posted_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.studio_video_performance TO authenticated;
GRANT ALL ON public.studio_video_performance TO service_role;

ALTER TABLE public.studio_video_performance ENABLE ROW LEVEL SECURITY;

-- Studio is team-only, gated server-side by requireTeamMember(). Inside the
-- app any authenticated session is a team member; service_role bypasses RLS.
CREATE POLICY "team can read performance"
  ON public.studio_video_performance FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "team can write performance"
  ON public.studio_video_performance FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "team can update performance"
  ON public.studio_video_performance FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "team can delete performance"
  ON public.studio_video_performance FOR DELETE
  TO authenticated USING (true);
