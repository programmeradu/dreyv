-- DACS Phase 5.2 — persist specialist AgentReports.
-- One row per handoff. commandId may have multiple rows (one per
-- specialist that responds), though Phase 5.1 routes to a single specialist
-- per command. Schema is forward-compatible with multi-specialist fanout.

CREATE TABLE IF NOT EXISTS dacs_handoffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id      text NOT NULL,
  wallet_address  text,
  specialist      text NOT NULL,
  intent_kind     text NOT NULL,
  status          text NOT NULL,      -- accepted | completed | rejected | deferred
  summary         text NOT NULL,
  report          jsonb NOT NULL,     -- full AgentReport payload
  step_results    jsonb,              -- detailed per-step trace
  duration_ms     integer,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dacs_handoffs_command_idx     ON dacs_handoffs (command_id);
CREATE INDEX IF NOT EXISTS dacs_handoffs_wallet_idx      ON dacs_handoffs (wallet_address);
CREATE INDEX IF NOT EXISTS dacs_handoffs_specialist_idx  ON dacs_handoffs (specialist);
CREATE INDEX IF NOT EXISTS dacs_handoffs_created_idx     ON dacs_handoffs (created_at DESC);
