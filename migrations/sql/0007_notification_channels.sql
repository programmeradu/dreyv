-- Phase 15: External notification channels
-- Adds Telegram + Slack delivery destinations to per-user notification preferences.
-- Both are opt-in and stored per user; webhook URLs and chat IDs are user-scoped.

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS telegram_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS telegram_chat_id  text,
  ADD COLUMN IF NOT EXISTS slack_enabled     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS slack_webhook_url text,
  ADD COLUMN IF NOT EXISTS slack_channel     text;

-- Delivery audit log: one row per (notification, channel) attempt.
-- Lets the UI surface "delivered to: email ✓, telegram ✓, slack ✗" and lets us retry.
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id              bigserial PRIMARY KEY,
  notification_id integer NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         text NOT NULL CHECK (channel IN ('email','telegram','slack','inapp')),
  status          text NOT NULL CHECK (status IN ('queued','sent','failed','skipped')),
  error           text,
  provider_id     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notif_deliveries_notif_idx
  ON notification_deliveries(notification_id);
CREATE INDEX IF NOT EXISTS notif_deliveries_channel_idx
  ON notification_deliveries(channel, status, created_at DESC);
