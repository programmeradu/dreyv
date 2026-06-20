-- 0031 — agent deliverables
-- One row per agent payment that produces an output the user (or their agent)
-- can later view. Powers /app/agent/deliverables, the post-payment emails, and
-- the permalink view page. Idempotent re-runs are safe.

CREATE TABLE IF NOT EXISTS agent_deliverables (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      UUID         NOT NULL REFERENCES agent_payments(id) ON DELETE CASCADE,
  user_id         UUID         NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
  api_key_id      UUID         NOT NULL REFERENCES agent_api_keys(id) ON DELETE CASCADE,

  -- snapshot | report | subscription
  kind            TEXT         NOT NULL,
  sku             TEXT         NOT NULL,

  -- The Solana address the snapshot/report was generated against.
  -- NULL for subscription deliverables.
  target_wallet   TEXT,

  -- generating | ready | failed
  status          TEXT         NOT NULL DEFAULT 'generating',

  -- Headline figures rendered in the email + list page (e.g. totalUsd, holdings, hhi).
  summary         JSONB        NOT NULL DEFAULT '{}'::jsonb,
  -- Full structured payload re-rendered on the view page (snapshot JSON,
  -- AI report markdown, tier+expiry, …).
  payload         JSONB        NOT NULL DEFAULT '{}'::jsonb,

  -- Optional rendered PDF in R2 for reports.
  pdf_url         TEXT,

  email_to        TEXT,
  email_message_id TEXT,
  email_sent_at   TIMESTAMPTZ,
  email_error     TEXT,

  error           TEXT,

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ready_at        TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_deliverables_user_idx     ON agent_deliverables(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_deliverables_api_key_idx  ON agent_deliverables(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_deliverables_payment_idx  ON agent_deliverables(payment_id);
CREATE INDEX IF NOT EXISTS agent_deliverables_kind_idx     ON agent_deliverables(kind);
CREATE UNIQUE INDEX IF NOT EXISTS agent_deliverables_payment_uniq ON agent_deliverables(payment_id);
