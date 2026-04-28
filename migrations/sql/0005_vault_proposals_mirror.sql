-- Mirror table: cached snapshot of Squads on-chain proposals for fast reads,
-- presence-aware UI, and War Room timelines.
CREATE TABLE IF NOT EXISTS "vault_proposals" (
  "id" serial PRIMARY KEY,
  "vault_address" text NOT NULL,
  "team_id" uuid REFERENCES "teams"("id") ON DELETE CASCADE,
  "transaction_index" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'Draft',
  "approvals" integer NOT NULL DEFAULT 0,
  "rejections" integer NOT NULL DEFAULT 0,
  "threshold" integer NOT NULL DEFAULT 1,
  "approved_by" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "rejected_by" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "summary" text,
  "raw" jsonb,
  "created_by" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "executed_at" timestamp,
  CONSTRAINT "vault_proposals_vault_tx_unique" UNIQUE ("vault_address", "transaction_index")
);

CREATE INDEX IF NOT EXISTS "vault_proposals_vault_idx" ON "vault_proposals" ("vault_address");
CREATE INDEX IF NOT EXISTS "vault_proposals_team_idx" ON "vault_proposals" ("team_id");
CREATE INDEX IF NOT EXISTS "vault_proposals_status_idx" ON "vault_proposals" ("status");
