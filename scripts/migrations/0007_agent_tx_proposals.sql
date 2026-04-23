-- Phase 6: HITL-gated transaction proposals queue.
-- Apply on Neon manually (drizzle/ is read-only in the dev sandbox):
--   psql $DATABASE_URL -f scripts/migrations/0007_agent_tx_proposals.sql

CREATE TABLE IF NOT EXISTS agent_tx_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid REFERENCES agent_proposals(id),
  user_id uuid REFERENCES users(id),
  chain text NOT NULL DEFAULT 'solana',
  kind text NOT NULL,
  summary text NOT NULL,
  unsigned_tx text,
  instructions jsonb,
  estimated_fee_sol numeric(12, 9),
  risk_level text NOT NULL DEFAULT 'medium',
  routing text NOT NULL DEFAULT 'wallet',
  multisig_vault text,
  status text NOT NULL DEFAULT 'queued',
  signature text,
  error_message text,
  meta jsonb,
  expires_at timestamp,
  approved_at timestamp,
  submitted_at timestamp,
  confirmed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_tx_proposals_status_idx ON agent_tx_proposals(status);
CREATE INDEX IF NOT EXISTS agent_tx_proposals_user_idx ON agent_tx_proposals(user_id);
CREATE INDEX IF NOT EXISTS agent_tx_proposals_proposal_idx ON agent_tx_proposals(proposal_id);
CREATE INDEX IF NOT EXISTS agent_tx_proposals_created_idx ON agent_tx_proposals(created_at);
