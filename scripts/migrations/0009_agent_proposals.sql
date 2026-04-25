-- Durable record of every proposal/alert the brain pipeline emits.
-- Matches src/db/schema.ts -> agentProposals.
-- Apply on Neon:
--   psql $DATABASE_URL -f scripts/migrations/0009_agent_proposals.sql
-- Then re-run scripts/migrations/0007_agent_tx_proposals.sql which depends on this.

CREATE TABLE IF NOT EXISTS "agent_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "thesis" text NOT NULL,
  "actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "risk_notes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "confidence" numeric(4, 3) NOT NULL DEFAULT 0.5,
  "horizon" text NOT NULL DEFAULT 'hours',
  "model" text NOT NULL DEFAULT 'unknown',
  "triage" jsonb,
  "opp" jsonb,
  "status" text NOT NULL DEFAULT 'open',
  "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "user_id" uuid REFERENCES "users"("id"),
  "acted_at" timestamp,
  "dismissed_at" timestamp,
  "observed_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "agent_proposals_status_idx" ON "agent_proposals" ("status");
CREATE INDEX IF NOT EXISTS "agent_proposals_kind_idx" ON "agent_proposals" ("kind");
CREATE INDEX IF NOT EXISTS "agent_proposals_created_idx" ON "agent_proposals" ("created_at");
CREATE INDEX IF NOT EXISTS "agent_proposals_user_idx" ON "agent_proposals" ("user_id");
