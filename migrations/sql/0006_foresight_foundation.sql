-- Phase 14: Treasury + Foresight foundation
-- Adds:
--   1) treasury_events  — USD-attributed event stream feeding Foresight
--                         (categorized inflow/outflow/yield/fee/swap), one row
--                         per logical economic event, derived from tx_events
--                         but flattened to USD impact for fast aggregation.
--   2) treasury_snapshots — periodic vault USD valuation snapshots, used to
--                           render the real treasury growth chart (replaces
--                           the synthetic sin-wave on /app/analytics) and to
--                           seed the Monte Carlo engine's drift baseline.

CREATE TABLE IF NOT EXISTS treasury_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  vault_address text,
  occurred_at   timestamp NOT NULL,
  -- inflow | outflow | yield | fee | swap | rebalance | airdrop | unknown
  kind          text NOT NULL,
  -- Free-form sub-category (payroll, treasury_topup, defi_harvest, ...)
  category      text,
  -- USD impact, signed: positive = treasury grew, negative = treasury shrank
  amount_usd    numeric(20, 6) NOT NULL,
  token_symbol  text,
  token_mint    text,
  counterparty  text,
  signature     text,
  source        text NOT NULL DEFAULT 'derived', -- derived | manual | helius | inngest
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS treasury_events_user_idx
  ON treasury_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS treasury_events_wallet_idx
  ON treasury_events (wallet_address, occurred_at DESC);
CREATE INDEX IF NOT EXISTS treasury_events_kind_idx
  ON treasury_events (kind, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS treasury_events_sig_uniq
  ON treasury_events (wallet_address, signature)
  WHERE signature IS NOT NULL;

CREATE TABLE IF NOT EXISTS treasury_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  vault_address text,
  total_usd     numeric(20, 6) NOT NULL,
  stable_usd    numeric(20, 6) NOT NULL DEFAULT 0,
  volatile_usd  numeric(20, 6) NOT NULL DEFAULT 0,
  yield_usd     numeric(20, 6) NOT NULL DEFAULT 0,
  -- { symbol, amount, priceUsd, valueUsd, isStable }[]
  composition   jsonb NOT NULL DEFAULT '[]'::jsonb,
  source        text NOT NULL DEFAULT 'wallet', -- wallet | manual | inngest
  captured_at   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS treasury_snapshots_user_idx
  ON treasury_snapshots (user_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS treasury_snapshots_wallet_idx
  ON treasury_snapshots (wallet_address, captured_at DESC);
