CREATE TABLE IF NOT EXISTS "studio_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "short_id" text NOT NULL,
  "user_id" uuid,
  "prompt" text NOT NULL,
  "prompt_category" text,
  "clarify_answers" jsonb,
  "chosen_integrations" jsonb,
  "unknown_protocols" jsonb,
  "research_sources" jsonb,
  "analyzer_outcome" text,
  "attempts" integer,
  "shipped" boolean DEFAULT false,
  "errors" jsonb,
  "duration_ms" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "studio_runs_short_id_unique" UNIQUE("short_id"),
  CONSTRAINT "studio_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action
);
CREATE INDEX IF NOT EXISTS "studio_runs_user_idx" ON "studio_runs" ("user_id");
CREATE INDEX IF NOT EXISTS "studio_runs_category_idx" ON "studio_runs" ("prompt_category");
CREATE INDEX IF NOT EXISTS "studio_runs_outcome_idx" ON "studio_runs" ("analyzer_outcome");
