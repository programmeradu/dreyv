-- 0030_agent_payment_consumed.sql
-- Tracks when a receipt token has been redeemed against a fulfilment
-- endpoint. Receipts are single-use: once consumed_at is set, the same
-- token can no longer pull paid output.

BEGIN;

ALTER TABLE public.agent_payments
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

CREATE INDEX IF NOT EXISTS agent_payments_consumed_idx
  ON public.agent_payments (consumed_at);

COMMIT;
