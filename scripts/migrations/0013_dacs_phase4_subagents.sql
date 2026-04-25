-- DACS Phase 4 — Sub-agent runtime.
--
-- A sub-agent is a long-running directive ("DCA 50 USDC into SOL daily for
-- 30 days", "alert me if any vault token drops 10% in 1h") that the router
-- defers to instead of executing immediately. Each tick runs the spec
-- through the DACS pipeline as a fresh command.
--
-- agent_subagents:
--   spec        — original raw text + parsed intent/plan template
--   schedule    — cron-like cadence (interval_seconds for now; cron later)
--   status      — active | paused | completed | failed | cancelled
--   next_run_at — driven by Inngest cron sweep
--   tick_count  — increments on every successful tick
--   max_ticks   — optional hard cap (e.g. 30 daily DCAs)

CREATE TABLE IF NOT EXISTS agent_subagents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address    text,
  parent_command_id text NOT NULL,
  title             text NOT NULL,
  raw_text          text NOT NULL,
  intent            jsonb NOT NULL,
  plan_template     jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'active',
  interval_seconds  integer NOT NULL DEFAULT 86400,
  next_run_at       timestamp NOT NULL DEFAULT now(),
  tick_count        integer NOT NULL DEFAULT 0,
  max_ticks         integer,
  last_tick_at      timestamp,
  last_tick_status  text,
  last_tick_note    text,
  expires_at        timestamp,
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_subagents_wallet_idx     ON agent_subagents(wallet_address);
CREATE INDEX IF NOT EXISTS agent_subagents_status_idx     ON agent_subagents(status);
CREATE INDEX IF NOT EXISTS agent_subagents_next_run_idx   ON agent_subagents(next_run_at);
CREATE INDEX IF NOT EXISTS agent_subagents_created_idx    ON agent_subagents(created_at DESC);
