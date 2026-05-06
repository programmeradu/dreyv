-- Phase 3 — Agent signing + caps + observability + circuit breaker

CREATE TABLE IF NOT EXISTS public.agent_signers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('session_key','squads_member')),
  pubkey text NOT NULL,
  label text,
  policy_caps jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked','expired')),
  expires_at timestamptz,
  kill_switch_at timestamptz,
  envelope_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vault_id, pubkey)
);
CREATE INDEX IF NOT EXISTS agent_signers_user_idx ON public.agent_signers(user_id);
CREATE INDEX IF NOT EXISTS agent_signers_vault_idx ON public.agent_signers(vault_id);
CREATE INDEX IF NOT EXISTS agent_signers_status_idx ON public.agent_signers(status);

CREATE TABLE IF NOT EXISTS public.agent_circuit_breaker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vault_id uuid,
  scope text NOT NULL DEFAULT 'autopilot',
  consecutive_failures int NOT NULL DEFAULT 0,
  last_firewall_reject_at timestamptz,
  frozen_until timestamptz,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_breaker_unique_idx
  ON public.agent_circuit_breaker(user_id, COALESCE(vault_id, '00000000-0000-0000-0000-000000000000'::uuid), scope);
CREATE INDEX IF NOT EXISTS agent_breaker_user_idx ON public.agent_circuit_breaker(user_id);

CREATE TABLE IF NOT EXISTS public.agent_autopilot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  job_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','executed','queued','skipped','failed')),
  outcome jsonb,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_autopilot_user_idx ON public.agent_autopilot_runs(user_id);
CREATE INDEX IF NOT EXISTS agent_autopilot_vault_idx ON public.agent_autopilot_runs(vault_id);
CREATE INDEX IF NOT EXISTS agent_autopilot_created_idx ON public.agent_autopilot_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_tool_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  capability_id text NOT NULL,
  command_id text,
  latency_ms int NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ok','error','denied','queued')),
  error_code text,
  tokens_in int,
  tokens_out int,
  cost_usd_est numeric(10,6),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_metrics_cap_idx ON public.agent_tool_metrics(capability_id);
CREATE INDEX IF NOT EXISTS agent_metrics_user_idx ON public.agent_tool_metrics(user_id);
CREATE INDEX IF NOT EXISTS agent_metrics_created_idx ON public.agent_tool_metrics(created_at DESC);
CREATE INDEX IF NOT EXISTS agent_metrics_outcome_idx ON public.agent_tool_metrics(outcome);

ALTER TABLE public.user_agent_policy
  ADD COLUMN IF NOT EXISTS policy_caps jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS min_idle_usd numeric;

ALTER TABLE public.agent_proposals
  ADD COLUMN IF NOT EXISTS policy_reason text,
  ADD COLUMN IF NOT EXISTS signer_id uuid,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_updated_at_v2()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_agent_signers_updated ON public.agent_signers;
CREATE TRIGGER trg_agent_signers_updated BEFORE UPDATE ON public.agent_signers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_v2();

DROP TRIGGER IF EXISTS trg_agent_breaker_updated ON public.agent_circuit_breaker;
CREATE TRIGGER trg_agent_breaker_updated BEFORE UPDATE ON public.agent_circuit_breaker
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_v2();
