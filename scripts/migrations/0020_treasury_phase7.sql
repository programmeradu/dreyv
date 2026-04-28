-- Phase 7 — Yield Routing, Reports/Share Links, Wallet Security
-- Three small vault-scoped tables backing the new canvas blocks on /app/treasury.
-- HITL execution still flows through agent_tx_proposals — these tables only
-- persist intent, schedule, audit trail.

-- ─── Yield Routing ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treasury_yield_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  vault_address text NOT NULL,
  token text NOT NULL DEFAULT 'USDC',
  venue text NOT NULL,            -- e.g. 'kamino', 'marginfi', 'lulo', 'drift'
  risk_band text NOT NULL DEFAULT 'conservative', -- conservative | balanced | aggressive
  target_amount numeric(28, 9) NOT NULL DEFAULT 0,
  min_apy_bps integer,
  status text NOT NULL DEFAULT 'draft', -- draft | active | paused | exited
  last_apy_bps integer,
  last_checked_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS treasury_yield_user_idx ON treasury_yield_routes(user_id);
CREATE INDEX IF NOT EXISTS treasury_yield_vault_idx ON treasury_yield_routes(vault_address);
CREATE INDEX IF NOT EXISTS treasury_yield_status_idx ON treasury_yield_routes(status);

-- ─── Reports & shareable links ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treasury_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  vault_address text NOT NULL,
  title text NOT NULL,
  period_start timestamptz,
  period_end timestamptz,
  share_token text UNIQUE,        -- public read-only slug; null = private
  share_expires_at timestamptz,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, -- composition, valuation, flows
  status text NOT NULL DEFAULT 'draft', -- draft | published | revoked
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS treasury_reports_user_idx ON treasury_reports(user_id);
CREATE INDEX IF NOT EXISTS treasury_reports_vault_idx ON treasury_reports(vault_address);
CREATE INDEX IF NOT EXISTS treasury_reports_share_idx ON treasury_reports(share_token);

-- ─── Wallet & Asset Security audits ────────────────────────────────────
CREATE TABLE IF NOT EXISTS treasury_security_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  vault_address text NOT NULL,
  score integer NOT NULL DEFAULT 0,        -- 0–100 hygiene score
  findings jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{ severity, code, message }]
  signers jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{ address, label, lastSeenAt }]
  threshold integer,
  is_multisig boolean NOT NULL DEFAULT false,
  last_audit_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS treasury_security_user_idx ON treasury_security_audits(user_id);
CREATE INDEX IF NOT EXISTS treasury_security_vault_idx ON treasury_security_audits(vault_address);
