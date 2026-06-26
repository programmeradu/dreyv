-- Persistent single-use replay guard for agent claim tokens.
-- The in-memory Set in claim/redeem resets per cold start / per instance on
-- Vercel, which means a token could theoretically be replayed against a fresh
-- instance within its JWT TTL. This table makes the replay check durable.

CREATE TABLE IF NOT EXISTS public.redeemed_claim_tokens (
  jti              text PRIMARY KEY,
  agent_user_id    uuid NOT NULL,
  customer_user_id uuid NOT NULL,
  redeemed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS redeemed_claim_tokens_customer_idx
  ON public.redeemed_claim_tokens(customer_user_id, redeemed_at DESC);
