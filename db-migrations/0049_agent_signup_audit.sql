-- 0049_agent_signup_audit.sql
-- Audit trail for machine signups (POST /api/agents/signup).

CREATE TABLE IF NOT EXISTS agent_signup_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  client_id   text NOT NULL,
  method      text NOT NULL,              -- 'dcr' | 'web-bot-auth' | 'siws' | 'siwe'
  caller_did  text,                       -- e.g. webbot key id, wallet
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_signup_audit_client_idx ON agent_signup_audit(client_id);
CREATE INDEX IF NOT EXISTS agent_signup_audit_ip_day_idx ON agent_signup_audit(ip, date_trunc('day', created_at));
