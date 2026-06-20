-- 0028_agent_payments_multirail.sql
-- Adds card rails (stripe, paystack) to agent_payments alongside Solana USDC.
-- agent_payments.invoice_id becomes nullable because card rails don't mint a crypto_invoice.

BEGIN;

ALTER TABLE public.agent_payments
  ALTER COLUMN invoice_id DROP NOT NULL;

ALTER TABLE public.agent_payments
  ADD COLUMN IF NOT EXISTS rail TEXT NOT NULL DEFAULT 'solana',
  ADD COLUMN IF NOT EXISTS provider_ref TEXT,
  ADD COLUMN IF NOT EXISTS checkout_url TEXT;

-- Backfill existing rows (all were Solana).
UPDATE public.agent_payments SET rail = 'solana' WHERE rail IS NULL;

CREATE INDEX IF NOT EXISTS agent_payments_rail_idx ON public.agent_payments (rail);
CREATE INDEX IF NOT EXISTS agent_payments_provider_ref_idx ON public.agent_payments (provider_ref);

COMMIT;
