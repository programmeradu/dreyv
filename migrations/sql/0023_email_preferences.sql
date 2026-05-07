-- Phase: per-user email preferences + per-template throttling
-- Each user gets one row. Booleans control opt-in for each proactive stream.
-- last_*_at columns power per-day / per-week / per-month throttles.

CREATE TABLE IF NOT EXISTS email_preferences (
  id                    bigserial PRIMARY KEY,
  user_id               uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- Master switch + per-stream opt-ins
  emails_enabled        boolean NOT NULL DEFAULT true,
  agent_insights        boolean NOT NULL DEFAULT true,
  opportunities         boolean NOT NULL DEFAULT true,
  vault_commands        boolean NOT NULL DEFAULT true,
  weekly_digest         boolean NOT NULL DEFAULT true,
  monthly_report        boolean NOT NULL DEFAULT true,
  anomaly_alerts        boolean NOT NULL DEFAULT true,
  approval_nudges       boolean NOT NULL DEFAULT true,
  upgrade_nudges        boolean NOT NULL DEFAULT true,
  reengagement          boolean NOT NULL DEFAULT true,
  onboarding_drip       boolean NOT NULL DEFAULT true,

  -- Throttle bookkeeping (UTC)
  last_agent_insight_at  timestamptz,
  last_opportunity_at    timestamptz,
  last_vault_commands_at timestamptz,
  last_weekly_digest_at  timestamptz,
  last_monthly_report_at timestamptz,
  last_anomaly_at        timestamptz,
  last_approval_nudge_at timestamptz,
  last_upgrade_nudge_at  timestamptz,
  last_reengagement_at   timestamptz,

  -- Onboarding drip state
  onboarding_day1_sent_at timestamptz,
  onboarding_day3_sent_at timestamptz,
  onboarding_day7_sent_at timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_prefs_user_idx ON email_preferences(user_id);
