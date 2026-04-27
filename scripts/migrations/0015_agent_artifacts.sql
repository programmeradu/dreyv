CREATE TABLE IF NOT EXISTS "agent_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_key" text NOT NULL,
  "wallet_address" text,
  "capability_id" text NOT NULL,
  "command_id" text,
  "kind" text NOT NULL,
  "filename" text NOT NULL,
  "mime" text NOT NULL,
  "bytes" integer NOT NULL,
  "body" bytea NOT NULL,
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "agent_artifacts_owner_idx" ON "agent_artifacts" ("owner_key");
CREATE INDEX IF NOT EXISTS "agent_artifacts_wallet_idx" ON "agent_artifacts" ("wallet_address");
CREATE INDEX IF NOT EXISTS "agent_artifacts_kind_idx" ON "agent_artifacts" ("kind");
CREATE INDEX IF NOT EXISTS "agent_artifacts_created_idx" ON "agent_artifacts" ("created_at");