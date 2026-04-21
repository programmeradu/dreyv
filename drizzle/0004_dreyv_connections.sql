-- Migration 0004: Add dreyv_connections table for encrypted provider credentials
CREATE TABLE IF NOT EXISTS "dreyv_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "label" text,
  "auth_type" text DEFAULT 'api_key' NOT NULL,
  "encrypted_secrets" text NOT NULL,
  "public_config" jsonb,
  "status" text DEFAULT 'active' NOT NULL,
  "last_used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "dreyv_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "dreyv_conn_user_provider_idx" ON "dreyv_connections" ("user_id", "provider");
CREATE INDEX IF NOT EXISTS "dreyv_conn_provider_idx" ON "dreyv_connections" ("provider");
