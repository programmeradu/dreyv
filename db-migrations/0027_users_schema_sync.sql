-- Sync the `users` table with src/db/schema.ts.
-- Safe to run multiple times — every change uses IF NOT EXISTS.
-- Fixes: "[SIWS] Auth error: Failed query: select ... from users where wallet_address = $1"
-- caused by columns referenced in code but missing in the prod database.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS evm_wallet_address    text,
  ADD COLUMN IF NOT EXISTS email                 text,
  ADD COLUMN IF NOT EXISTS display_name          text,
  ADD COLUMN IF NOT EXISTS avatar_seed           text,
  ADD COLUMN IF NOT EXISTS role                  text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS tier                  text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS tier_expires_at       timestamp,
  ADD COLUMN IF NOT EXISTS is_founding_member    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS founding_number       integer,
  ADD COLUMN IF NOT EXISTS onboarding_completed  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS organization_name     text,
  ADD COLUMN IF NOT EXISTS supabase_user_id      text,
  ADD COLUMN IF NOT EXISTS created_at            timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_login_at         timestamp NOT NULL DEFAULT now();

-- Uniqueness + indexes (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS users_supabase_user_id_key ON public.users (supabase_user_id);
CREATE INDEX        IF NOT EXISTS users_wallet_idx           ON public.users (wallet_address);
CREATE INDEX        IF NOT EXISTS users_supabase_idx         ON public.users (supabase_user_id);
CREATE INDEX        IF NOT EXISTS users_tier_idx             ON public.users (tier);
CREATE INDEX        IF NOT EXISTS users_evm_wallet_idx       ON public.users (evm_wallet_address);

-- Unique founding number when present
CREATE UNIQUE INDEX IF NOT EXISTS users_founding_number_key
  ON public.users (founding_number)
  WHERE founding_number IS NOT NULL;
