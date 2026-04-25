-- Reflector-driven persistent sub-agents.
-- Matches src/db/schema.ts -> agentSubagents.
CREATE TABLE IF NOT EXISTS "agent_subagents" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "goal" text NOT NULL,
  "triggers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "capabilities" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "parent" text NOT NULL DEFAULT 'reflector',
  "status" text NOT NULL DEFAULT 'active',
  "ttl_minutes" integer NOT NULL DEFAULT 240,
  "expires_at" timestamp NOT NULL,
  "notes" text,
  "spec" jsonb NOT NULL,
  "user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "agent_subagents_status_idx" ON "agent_subagents" ("status");
CREATE INDEX IF NOT EXISTS "agent_subagents_expires_idx" ON "agent_subagents" ("expires_at");
CREATE INDEX IF NOT EXISTS "agent_subagents_user_idx" ON "agent_subagents" ("user_id");
