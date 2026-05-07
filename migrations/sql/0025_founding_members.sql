-- Founding 200 program: track first 200 signups and grant them Mini-equivalent access.
-- See pricing page "Founding 200" ribbon and /api/founding/status.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_founding_member" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "founding_number" integer;

CREATE UNIQUE INDEX IF NOT EXISTS "users_founding_number_idx"
  ON "users" ("founding_number")
  WHERE "founding_number" IS NOT NULL;
