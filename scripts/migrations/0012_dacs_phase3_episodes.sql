-- DACS Phase 3 — Episodic memory.
--
-- Every settled command (auto-executed, approved-then-executed, or rejected)
-- writes a row here. The planner uses these to learn from past outcomes:
-- "last 5 times this wallet asked for a swap > $10k, 3 were approved and 2
-- were cancelled at sign step" feeds back into future risk_score.
--
-- Schema is intentionally narrow: we store the intent kind + capability ids
-- + outcome + value, NOT raw plan/decision blobs (those still live in
-- command_diff_log + command_approvals). Keeps episodes cheap to query.

CREATE TABLE IF NOT EXISTS agent_episodes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id      text NOT NULL,
  wallet_address  text,
  intent_kind     text NOT NULL,
  capability_ids  jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome         text NOT NULL,                  -- auto_executed | approved_executed | approved_failed | rejected | expired | cancelled
  risk_score      numeric,
  value_usd       numeric,
  duration_ms     integer,
  signature       text,                            -- on-chain tx sig if applicable
  notes           text,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_episodes_wallet_idx ON agent_episodes(wallet_address);
CREATE INDEX IF NOT EXISTS agent_episodes_intent_idx ON agent_episodes(intent_kind);
CREATE INDEX IF NOT EXISTS agent_episodes_outcome_idx ON agent_episodes(outcome);
CREATE INDEX IF NOT EXISTS agent_episodes_created_idx ON agent_episodes(created_at DESC);
