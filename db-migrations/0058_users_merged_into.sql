-- 0058_users_merged_into.sql
-- Track when an agent user is absorbed into a customer account. Reads/writes
-- against the absorbed agent's balance follow this pointer to the surviving
-- customer row, so the agent's dk_live_ keys keep working post-claim without
-- silently re-creating a phantom 0-balance row (the prior DELETE+upsert bug
-- that caused ledger math to disagree with reality).
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS merged_into_user_id uuid
    REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_merged_into_user_id_idx
  ON users(merged_into_user_id)
  WHERE merged_into_user_id IS NOT NULL;

COMMIT;
