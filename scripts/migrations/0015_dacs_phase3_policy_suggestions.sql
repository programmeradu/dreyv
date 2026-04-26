-- DACS Phase 3 — Policy derivation suggestions.
--
-- The nightly policy-derivation cron reads recent agent_episodes and proposes
-- changes to user_agent_policy. Low-risk changes (e.g. add a protocol the user
-- has already approved 3+ times with no rejections) auto-apply. Higher-impact
-- changes (raise auto-approve threshold, add daily cap) are stored here and
-- surfaced in /app/settings for the user to accept or dismiss.
ALTER TABLE user_agent_policy
  ADD COLUMN IF NOT EXISTS pending_suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_derivation_at  timestamp;

-- Suggestion shape (for reference, not enforced):
-- {
--   "id": "sug_xxx",
--   "kind": "raise_auto_approve_threshold" | "add_protocol_allowlist"
--         | "lower_daily_cap" | "add_protocol_denylist",
--   "value": <kind-specific>,
--   "rationale": "Last 14 days: 8 approved swaps via Jupiter, 0 rejected, max value $4,200",
--   "confidence": 0.0..1.0,
--   "createdAt": "ISO-8601"
-- }
