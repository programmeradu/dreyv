-- OAuth 2.1 + Dynamic Client Registration server schema.
-- All tables locked down — only server code touches them via DATABASE_URL.

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id                        text PRIMARY KEY,
  client_secret_hash               text,                       -- null = public client (PKCE required)
  client_name                      text NOT NULL,
  client_uri                       text,
  logo_uri                         text,
  redirect_uris                    text[] NOT NULL,
  grant_types                      text[] NOT NULL DEFAULT ARRAY['authorization_code','refresh_token']::text[],
  response_types                   text[] NOT NULL DEFAULT ARRAY['code']::text[],
  token_endpoint_auth_method       text NOT NULL DEFAULT 'none',
  scopes                           text[] NOT NULL DEFAULT ARRAY[]::text[],
  software_id                      text,
  software_version                 text,
  registration_access_token_hash   text,
  created_by_user_id               uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                       timestamptz NOT NULL DEFAULT now(),
  disabled_at                      timestamptz
);

CREATE INDEX IF NOT EXISTS oauth_clients_created_by_idx ON oauth_clients(created_by_user_id);

CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  code_hash               text PRIMARY KEY,
  client_id               text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes                  text[] NOT NULL,
  redirect_uri            text NOT NULL,
  code_challenge          text NOT NULL,
  code_challenge_method   text NOT NULL DEFAULT 'S256',
  nonce                   text,
  state                   text,
  expires_at              timestamptz NOT NULL,
  consumed_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_auth_codes_expires_idx ON oauth_auth_codes(expires_at);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash              text PRIMARY KEY,
  token_type              text NOT NULL,                       -- 'access' | 'refresh'
  client_id               text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id                 uuid REFERENCES users(id) ON DELETE CASCADE,  -- null for client_credentials
  scopes                  text[] NOT NULL,
  jti                     text,                                 -- for access JWTs
  parent_refresh_hash     text,                                 -- rotation chain root
  expires_at              timestamptz NOT NULL,
  revoked_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_tokens_client_idx ON oauth_tokens(client_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_user_idx ON oauth_tokens(user_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_parent_idx ON oauth_tokens(parent_refresh_hash);
CREATE INDEX IF NOT EXISTS oauth_tokens_expires_idx ON oauth_tokens(expires_at);

CREATE TABLE IF NOT EXISTS oauth_device_codes (
  device_code_hash        text PRIMARY KEY,
  user_code               text NOT NULL UNIQUE,
  client_id               text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  scopes                  text[] NOT NULL,
  expires_at              timestamptz NOT NULL,
  interval_seconds        integer NOT NULL DEFAULT 5,
  approved_user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at             timestamptz,
  denied_at               timestamptz,
  last_polled_at          timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_device_codes_user_code_idx ON oauth_device_codes(user_code);

CREATE TABLE IF NOT EXISTS oauth_signing_keys (
  kid                     text PRIMARY KEY,
  algorithm               text NOT NULL DEFAULT 'ES256',
  public_jwk              jsonb NOT NULL,
  private_jwk_encrypted   bytea NOT NULL,                       -- AES-256-GCM(iv || ciphertext || tag)
  status                  text NOT NULL DEFAULT 'active',       -- active | rotating | retired
  created_at              timestamptz NOT NULL DEFAULT now(),
  retired_at              timestamptz
);

CREATE INDEX IF NOT EXISTS oauth_signing_keys_status_idx ON oauth_signing_keys(status);

CREATE TABLE IF NOT EXISTS oauth_consents (
  user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id               text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  scopes                  text[] NOT NULL,
  granted_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id)
);

CREATE TABLE IF NOT EXISTS oauth_registration_attempts (
  ip                      text NOT NULL,
  day                     text NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD'),
  count                   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, day)
);

-- Grants — DATABASE_URL is the Neon owner role; no PostgREST RLS layer here.
-- (Schema lives in Neon Postgres, not Supabase Data API.)
