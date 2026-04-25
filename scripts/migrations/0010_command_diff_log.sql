-- DACS Phase 1 — shadow-mode diff log.
-- Records each command processed by both the legacy CommandBar pipeline
-- and the new DACS pipeline so we can compare plan/decision parity before
-- the Phase 6 cutover.
CREATE TABLE IF NOT EXISTS command_diff_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id      text NOT NULL UNIQUE,
  wallet_address  text,
  raw_text        text NOT NULL,
  prompt_mode     text NOT NULL DEFAULT 'auto',
  -- Legacy pipeline snapshot (the response actually served to the user).
  legacy_summary       text,
  legacy_tool_calls    jsonb,
  legacy_decision_kind text,        -- auto_execute | queue_for_approval | ask_clarification | reject
  legacy_latency_ms    integer,
  -- DACS pipeline snapshot (shadow).
  dacs_intent          jsonb,
  dacs_plan            jsonb,
  dacs_decision_kind   text,
  dacs_decision_reason text,
  dacs_latency_ms      integer,
  -- Computed parity verdict, set by the diff harness.
  parity               text,        -- match | drift | dacs_only | legacy_only | error
  parity_notes         text,
  created_at           timestamp NOT NULL DEFAULT now(),
  updated_at           timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS command_diff_log_created_idx ON command_diff_log (created_at DESC);
CREATE INDEX IF NOT EXISTS command_diff_log_parity_idx  ON command_diff_log (parity);
CREATE INDEX IF NOT EXISTS command_diff_log_wallet_idx  ON command_diff_log (wallet_address);
