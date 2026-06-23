-- 0050_agent_balances.sql
-- Pre-funded balance ("metered prepaid") rail for autonomous agents.
-- Agents top up once (Stripe checkout, x402, or manual crypto deposit)
-- and capabilities deduct from this balance per call. Returns 402 with a
-- top-up URL when empty — no on-chain settlement on every request.
--
-- All amounts are USDC minor units (6 decimals). 1 USDC = 1_000_000.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_balances (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_minor  bigint NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  currency       text   NOT NULL DEFAULT 'USDC',
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_balance_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta_minor     bigint NOT NULL,          -- positive = credit, negative = debit
  balance_after   bigint NOT NULL,
  reason          text   NOT NULL,          -- 'topup_stripe' | 'topup_x402' | 'topup_manual' | 'charge:<sku>' | 'refund'
  ref             text,                     -- provider id / tx hash / payment id
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_balance_ledger_user_idx
  ON agent_balance_ledger(user_id, created_at DESC);

-- Idempotency: never double-credit the same external receipt.
CREATE UNIQUE INDEX IF NOT EXISTS agent_balance_ledger_reason_ref_uniq
  ON agent_balance_ledger(reason, ref) WHERE ref IS NOT NULL;

COMMIT;
