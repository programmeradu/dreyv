-- Run this manually (drizzle/ folder is gitignored/read-only here).
-- Equivalent Drizzle generation would produce the same DDL.

CREATE TABLE IF NOT EXISTS "waitlist_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL UNIQUE,
  "name" text,
  "organization" text,
  "role" text,
  "org_type" text,
  "chains" jsonb,
  "current_stack" text,
  "aum_band" text,
  "use_case" text,
  "referral_source" text,
  "status" text NOT NULL DEFAULT 'pending',
  "position" serial NOT NULL,
  "invited_at" timestamp,
  "onboarded_at" timestamp,
  "invite_token" text UNIQUE,
  "invite_expires_at" timestamp,
  "notes" text,
  "ip_hash" text,
  "user_agent" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "waitlist_email_idx"        ON "waitlist_entries" ("email");
CREATE INDEX IF NOT EXISTS "waitlist_status_idx"       ON "waitlist_entries" ("status");
CREATE INDEX IF NOT EXISTS "waitlist_invite_token_idx" ON "waitlist_entries" ("invite_token");
CREATE INDEX IF NOT EXISTS "waitlist_created_idx"      ON "waitlist_entries" ("created_at");
