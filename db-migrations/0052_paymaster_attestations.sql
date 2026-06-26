-- 0052 — Kora-style paymaster ledger + Solana attestations
--
-- Two surfaces shipped together:
--   1. paymaster_sponsorships — append-only audit log for every gasless tx
--      sponsored by Dreyv's Kora paymaster. The actual debit lives in
--      agent_balance_ledger (reason='paymaster_fee').
--   2. agent_attestations — ed25519-signed credentials about agents/users
--      (identity, scopes, KYB, free-form claims). Compatible with the
--      Solana Attestation Service "offchain" shape.

CREATE TABLE IF NOT EXISTS public.paymaster_sponsorships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  api_key_id   uuid REFERENCES public.public_api_keys(id) ON DELETE SET NULL,
  signature    text NOT NULL,
  fee_lamports text NOT NULL,            -- bigint as text
  charged_minor text NOT NULL,           -- USDC minor units debited from prepaid balance
  markup_minor  text NOT NULL DEFAULT '0',
  status       text NOT NULL DEFAULT 'submitted', -- submitted | confirmed | failed
  err          text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paymaster_sponsorships_user_idx
  ON public.paymaster_sponsorships (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS paymaster_sponsorships_signature_uniq
  ON public.paymaster_sponsorships (signature);

GRANT SELECT, INSERT, UPDATE ON public.paymaster_sponsorships TO authenticated;
GRANT ALL ON public.paymaster_sponsorships TO service_role;

CREATE TABLE IF NOT EXISTS public.agent_attestations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  subject_wallet  text,                  -- subject can be a wallet pubkey too
  schema       text NOT NULL,            -- e.g. dreyv.agent.identity.v1
  claims       jsonb NOT NULL,
  issuer       text NOT NULL,            -- ed25519 pubkey (base58) of the issuer
  signature    text NOT NULL,            -- base64(ed25519 sig over canonical claims)
  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS agent_attestations_subject_user_idx
  ON public.agent_attestations (subject_user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS agent_attestations_subject_wallet_idx
  ON public.agent_attestations (subject_wallet);
CREATE INDEX IF NOT EXISTS agent_attestations_schema_idx
  ON public.agent_attestations (schema);

-- Attestations are PUBLICLY verifiable by design (it's the whole point of
-- a credential). Allow anon SELECT so any agent can resolve them by id.
GRANT SELECT ON public.agent_attestations TO anon;
GRANT SELECT, INSERT, UPDATE ON public.agent_attestations TO authenticated;
GRANT ALL ON public.agent_attestations TO service_role;
