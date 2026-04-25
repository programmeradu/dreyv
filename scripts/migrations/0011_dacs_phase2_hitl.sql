-- DACS Phase 2 — HITL approval queue + per-user policy.
--
-- command_approvals:
--   Every queued plan from the DACS router lands here. Users approve/reject
--   from /app inbox. Resolved rows feed episodic memory in Phase 3.
--
-- user_agent_policy:
--   Per-wallet policy that the router consults before deciding auto-execute
--   vs. HITL. Defaults are conservative (require approval for everything).

CREATE TABLE IF NOT EXISTS command_approvals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id      text NOT NULL,
  wallet_address  text,
  status          text NOT NULL DEFAULT 'pending', -- pending | approved | rejected | expired | executed
  reason          text NOT NULL,                    -- router reason (e.g. "High risk 0.82")
  intent          jsonb NOT NULL,
  plan            jsonb NOT NULL,
  decision        jsonb NOT NULL,                   -- full RouteDecision snapshot
  risk_score      numeric,
  estimated_value_usd numeric,
  resolved_at     timestamp,
  resolved_by     text,
  resolution_note text,
  expires_at      timestamp NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS command_approvals_wallet_idx
  ON command_approvals(wallet_address);
CREATE INDEX IF NOT EXISTS command_approvals_status_idx
  ON command_approvals(status);
CREATE INDEX IF NOT EXISTS command_approvals_command_idx
  ON command_approvals(command_id);
CREATE INDEX IF NOT EXISTS command_approvals_created_idx
  ON command_approvals(created_at DESC);

CREATE TABLE IF NOT EXISTS user_agent_policy (
  wallet_address           text PRIMARY KEY,
  auto_approve_below_usd   numeric NOT NULL DEFAULT 0,
  require_multisig_above_usd numeric,
  protocol_allowlist       jsonb NOT NULL DEFAULT '[]'::jsonb,
  protocol_denylist        jsonb NOT NULL DEFAULT '[]'::jsonb,
  allow_dynamic_writes     boolean NOT NULL DEFAULT false,
  daily_value_cap_usd      numeric,
  updated_at               timestamp NOT NULL DEFAULT now(),
  created_at               timestamp NOT NULL DEFAULT now()
);
