-- Phase 5 — Wallet & Vault management
-- Adds `kind` to vaults: 'connected' | 'watch' | 'multisig'.
-- Backfills existing rows: rows with is_multisig=true become 'multisig'.

ALTER TABLE vaults
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'connected';

-- Add a soft check constraint (skipped if it already exists).
DO $$ BEGIN
  ALTER TABLE vaults
    ADD CONSTRAINT vaults_kind_check
    CHECK (kind IN ('connected', 'watch', 'multisig'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

UPDATE vaults SET kind = 'multisig' WHERE is_multisig = true AND kind = 'connected';

CREATE INDEX IF NOT EXISTS vaults_kind_idx ON vaults(kind);
