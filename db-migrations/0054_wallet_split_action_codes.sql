-- 0054 — Hot/Cold key split, per-wallet caps, one-time action codes.
--
-- # Wallet split (#1)
-- `agent_wallets`     = HOT  (low-limit signer; existing table).
-- `agent_cold_wallets`= COLD (sweep destination; refills HOT via action code).
--
-- # Caps (#1)
-- Per-user soft limits on autonomous spend. Enforced in x402 settlement
-- paths. Defaults are conservative ($50 per-tx, $200 per-day).
--
-- # Action codes (#3)
-- 6-digit codes a human approves at /app/approve/<id>. Any agent action
-- can attach `intent`/`amount_minor` and poll for approval before
-- continuing. Codes are single-use, 10-minute TTL.

CREATE TABLE IF NOT EXISTS agent_cold_wallets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  public_key       text NOT NULL UNIQUE,
  encrypted_secret text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_cold_wallets_public_key_idx ON agent_cold_wallets(public_key);

CREATE TABLE IF NOT EXISTS agent_wallet_caps (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  per_tx_max_minor   bigint NOT NULL DEFAULT 50000000,   -- $50 (USDC 6dp)
  per_day_max_minor  bigint NOT NULL DEFAULT 200000000,  -- $200
  require_code_above bigint NOT NULL DEFAULT 25000000,   -- $25
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_action_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id    uuid REFERENCES agent_api_keys(id) ON DELETE SET NULL,
  code_hash     text NOT NULL,                 -- sha256(code), case-folded
  intent        text NOT NULL,                 -- short machine label, e.g. "wallet.refill_hot"
  description   text NOT NULL,                 -- human-friendly summary
  amount_minor  bigint,                        -- optional, for spend approvals
  currency      text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | expired | consumed
  approved_at   timestamptz,
  consumed_at   timestamptz,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_action_codes_user_idx ON agent_action_codes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_action_codes_status_idx ON agent_action_codes(user_id, status);
