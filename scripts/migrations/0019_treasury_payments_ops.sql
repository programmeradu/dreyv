-- Phase 6 — Payments & Treasury Operations
-- Adds three tables backing the new canvas blocks on /app/treasury:
--   1. treasury_recurring_payouts  — payroll/grants on a schedule
--   2. treasury_gas_tank_watchers  — auto-top-up rules per vault
--   3. treasury_invoices           — invoice inbox queued for batch pay
--
-- All three are user-scoped (no RLS — Drizzle/Neon project, gated at API
-- via resolveUserIdFromWallet). HITL execution flows through the existing
-- agent_tx_proposals queue, so we only persist intent + schedule here.

CREATE TABLE IF NOT EXISTS treasury_recurring_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  vault_address   text NOT NULL,
  label           text NOT NULL,
  -- 'monthly' | 'biweekly' | 'weekly' | 'manual'
  cadence         text NOT NULL DEFAULT 'monthly',
  -- ISO day-of-month (monthly), ISO weekday (weekly), or null for manual
  anchor_day      integer,
  default_token   text NOT NULL DEFAULT 'USDC',
  -- recipients: [{ address, amount, label? }]
  recipients      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 'active' | 'paused' | 'archived'
  status          text NOT NULL DEFAULT 'active',
  next_run_at     timestamptz,
  last_run_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS treasury_recurring_user_idx
  ON treasury_recurring_payouts (user_id);
CREATE INDEX IF NOT EXISTS treasury_recurring_vault_idx
  ON treasury_recurring_payouts (vault_address);
CREATE INDEX IF NOT EXISTS treasury_recurring_next_run_idx
  ON treasury_recurring_payouts (next_run_at)
  WHERE status = 'active';


CREATE TABLE IF NOT EXISTS treasury_gas_tank_watchers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES users(id) ON DELETE CASCADE,
  vault_address     text NOT NULL,
  -- minimum SOL balance — below this, top-up triggers
  min_sol           numeric(18, 9) NOT NULL DEFAULT 0.5,
  -- target balance to refill to
  target_sol        numeric(18, 9) NOT NULL DEFAULT 2,
  -- where the SOL comes from (another vault address user owns)
  funding_address   text,
  -- max per top-up — anything above goes to HITL even if auto-approve is on
  cap_per_topup_sol numeric(18, 9) NOT NULL DEFAULT 1,
  status            text NOT NULL DEFAULT 'active', -- active | paused
  last_balance_sol  numeric(18, 9),
  last_checked_at   timestamptz,
  last_topup_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS treasury_gas_tank_vault_uniq
  ON treasury_gas_tank_watchers (vault_address);
CREATE INDEX IF NOT EXISTS treasury_gas_tank_user_idx
  ON treasury_gas_tank_watchers (user_id);


CREATE TABLE IF NOT EXISTS treasury_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  vault_address   text NOT NULL,
  vendor_name     text NOT NULL,
  pay_to_address  text NOT NULL,
  amount          numeric(28, 9) NOT NULL,
  token           text NOT NULL DEFAULT 'USDC',
  memo            text,
  due_at          timestamptz,
  -- 'pending' | 'queued' | 'paid' | 'rejected'
  status          text NOT NULL DEFAULT 'pending',
  tx_proposal_id  uuid REFERENCES agent_tx_proposals(id) ON DELETE SET NULL,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS treasury_invoices_user_idx
  ON treasury_invoices (user_id);
CREATE INDEX IF NOT EXISTS treasury_invoices_vault_idx
  ON treasury_invoices (vault_address);
CREATE INDEX IF NOT EXISTS treasury_invoices_status_idx
  ON treasury_invoices (status);
CREATE INDEX IF NOT EXISTS treasury_invoices_due_idx
  ON treasury_invoices (due_at);
