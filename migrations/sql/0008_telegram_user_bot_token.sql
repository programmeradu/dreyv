-- Phase 15.1: Per-user Telegram bot token (BYO bot model)
-- Each user brings their own bot from @BotFather; Dreyv hosts none.
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS telegram_bot_token text;
