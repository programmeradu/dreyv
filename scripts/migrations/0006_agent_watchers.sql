-- Phase 5: per-wallet treasury watchers + ensure user_id on brain tables.
-- Apply on Neon manually (drizzle/ is read-only in the dev sandbox):
--   psql $DATABASE_URL -f scripts/migrations/0006_agent_watchers.sql

CREATE TABLE IF NOT EXISTS agent_treasury_watchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  chain text NOT NULL,
  address text NOT NULL,
  label text,
  active boolean NOT NULL DEFAULT true,
  last_scan_at timestamp,
  last_snapshot jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_watchers_user_idx ON agent_treasury_watchers(user_id);
CREATE INDEX IF NOT EXISTS agent_watchers_active_idx ON agent_treasury_watchers(active);
CREATE INDEX IF NOT EXISTS agent_watchers_addr_idx ON agent_treasury_watchers(address);

ALTER TABLE agent_proposals ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id);
ALTER TABLE agent_subagents ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS agent_proposals_user_idx ON agent_proposals(user_id);
CREATE INDEX IF NOT EXISTS agent_subagents_user_idx ON agent_subagents(user_id);
