-- Phase 7A.2 — Migrate agent artifacts to Cloudflare R2.
-- Adds r2_key column, makes legacy body nullable, creates failure log table.

ALTER TABLE IF EXISTS agent_artifacts
  ADD COLUMN IF NOT EXISTS r2_key text;

ALTER TABLE IF EXISTS agent_artifacts
  ALTER COLUMN body DROP NOT NULL;

CREATE TABLE IF NOT EXISTS artifact_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_key text NOT NULL,
  wallet_address text,
  capability_id text NOT NULL,
  command_id text,
  kind text NOT NULL,
  filename text NOT NULL,
  mime text NOT NULL,
  bytes integer NOT NULL,
  stage text NOT NULL,
  error text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  retry_count integer NOT NULL DEFAULT 0,
  resolved_artifact_id uuid,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artifact_failures_owner_idx ON artifact_failures(owner_key);
CREATE INDEX IF NOT EXISTS artifact_failures_created_idx ON artifact_failures(created_at);
