-- 0029_agent_wallets.sql
-- Per-user hosted Solana wallet used for end-to-end autonomous agent
-- payments. Private key is encrypted at rest with KEYPAIR_MASTER_KEY
-- (same envelope as DCA bot keypairs, see src/lib/keypair-envelope.ts).
-- One wallet per user; created lazily on first /api/agent/wallet GET.

BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_wallets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  public_key       text NOT NULL UNIQUE,
  encrypted_secret text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_wallets_public_key_idx ON public.agent_wallets (public_key);

COMMIT;
