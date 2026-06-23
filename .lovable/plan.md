# OAuth 2.1 + Dynamic Client Registration server

Goal: let MCP clients (Claude, ChatGPT, Cursor) self-register and obtain tokens that authorize calls to `/api/mcp` and `/api/v1/*`. Bind issued tokens to the existing dreyv session (SIWS JWT cookie or Neon Auth cookie) — no new login system.

## Surface (all under `src/app/api/oauth/*`)

```text
POST /api/oauth/register          RFC 7591 Dynamic Client Registration
GET  /api/oauth/authorize         Auth-code + PKCE; renders consent screen
POST /api/oauth/authorize         Consent submit → issues code, 302 to redirect_uri
POST /api/oauth/token             code | refresh_token | client_credentials | device_code
POST /api/oauth/device            RFC 8628 device authorization request
GET  /api/oauth/device/verify     User-facing device-code entry page
POST /api/oauth/introspect        RFC 7662
POST /api/oauth/revoke            RFC 7009
GET  /api/oauth/userinfo          OIDC userinfo
GET  /.well-known/jwks.json       Public JWKS (already advertised)
```

Discovery docs already published at `/.well-known/openid-configuration` and `/oauth-protected-resource` — endpoints will now resolve.

## Schema (one migration, Neon Postgres — same DB as the rest of the app)

Tables in `dreyv_oauth` schema (or `public` if simpler):

- `oauth_clients` — `client_id`, `client_secret_hash` (null for public/PKCE-only), `client_name`, `redirect_uris[]`, `grant_types[]`, `response_types[]`, `token_endpoint_auth_method`, `scopes[]`, `software_id`, `software_version`, `registration_access_token_hash`, `created_by_user_id` (null for self-registered), `created_at`.
- `oauth_auth_codes` — `code_hash`, `client_id`, `user_id`, `scopes[]`, `redirect_uri`, `code_challenge`, `code_challenge_method`, `nonce`, `expires_at` (10 min), `consumed_at`.
- `oauth_tokens` — `token_hash`, `token_type` (`access` | `refresh`), `client_id`, `user_id`, `scopes[]`, `expires_at`, `revoked_at`, `parent_refresh_hash` (for rotation chain), `created_at`. Access tokens are signed JWTs; we still log a hash for revocation/introspection.
- `oauth_device_codes` — `device_code_hash`, `user_code` (8 chars), `client_id`, `scopes[]`, `expires_at` (15 min), `interval_seconds`, `approved_user_id`, `approved_at`, `denied_at`, `last_polled_at`.
- `oauth_signing_keys` — `kid`, `algorithm` (`ES256`), `public_jwk` (jsonb), `private_jwk_encrypted` (bytea), `status` (`active` | `rotating` | `retired`), `created_at`, `retired_at`. Rotation policy: active + previous (still valid for verification) for 30 days.
- `oauth_consents` — `user_id`, `client_id`, `scopes[]`, `granted_at`. Lets us skip the consent screen on re-auth when scopes match.

All RLS-locked to `service_role`; only server code touches them.

## Key management

- ES256 keypair, kid = ULID. Private JWK encrypted at rest with `KEYPAIR_MASTER_KEY` (already a secret) via AES-256-GCM in `src/lib/oauth/keys.ts`.
- `getActiveSigner()` returns the current signer; `getVerifierKeySet()` returns all non-retired keys for `jwtVerify`.
- Rotation script (`scripts/rotate-oauth-keys.mjs`) — marks current key `rotating`, creates new `active`, retires keys older than 30 days. Documented; not auto-run.

## Flows

### Dynamic Client Registration (RFC 7591)

`POST /api/oauth/register` accepts any client. Required: `redirect_uris`. Optional: `client_name`, `grant_types`, `token_endpoint_auth_method` (default `none` → public client, PKCE required). Returns `client_id`, `client_secret` (only for confidential), `registration_access_token`, `client_id_issued_at`. We rate-limit per IP (existing limiter) and cap to 50 self-registered clients per IP per day.

### Authorization Code + PKCE

`GET /api/oauth/authorize` validates `client_id`, `redirect_uri`, `response_type=code`, `code_challenge`, `code_challenge_method=S256`, `scope`, `state`. If no active dreyv session → 302 to `/auth?next=<authorize-url>`. If session exists and consent already granted for same scopes → auto-approve, redirect with `code`. Otherwise render `/oauth/consent` (server component) with client name, scopes, allow/deny buttons. Submit `POST /api/oauth/authorize` with a CSRF token, mint a 10-min one-time code.

### Token endpoint

`POST /api/oauth/token` handles `grant_type`:
- `authorization_code` — verify code, PKCE, redirect_uri match; mark code consumed; issue access JWT (1h) + refresh token (30d).
- `refresh_token` — verify and rotate (issue new refresh, mark old `revoked_at` with `parent_refresh_hash` link). Reuse-detection: if a revoked refresh is presented, revoke the entire chain.
- `client_credentials` — confidential clients only; user-less token for org/service use (scope-limited).
- `urn:ietf:params:oauth:grant-type:device_code` — verify polled device code, return tokens once `approved_user_id` set.

Access JWT claims: `iss`, `sub` (user id or `client:<client_id>` for client_credentials), `aud` = `${origin}/api`, `client_id`, `scope`, `jti`, `iat`, `exp`, `kid` in header.

### Device flow

`POST /api/oauth/device` returns `device_code`, `user_code`, `verification_uri = ${origin}/oauth/device`, `verification_uri_complete`, `expires_in`, `interval`. User visits `/oauth/device`, signs in if needed, enters `user_code`, sees consent, approves. Polling at `/api/oauth/token` returns `authorization_pending`, `slow_down`, `access_denied`, or tokens.

### Introspection & revocation

- `/introspect` — confidential clients (or registered MCP clients with their registration_access_token) get `{ active, scope, client_id, sub, exp }`. Looks up token hash; checks `revoked_at` and `exp`.
- `/revoke` — accepts access or refresh token; sets `revoked_at`.

## MCP/REST integration

`src/lib/auth/bearer.ts` already validates `dk_live_*` API keys. Extend it: if the bearer is a JWT (starts with `eyJ`), verify against `getVerifierKeySet()`, check `aud`, `exp`, `revoked_at` (token_hash lookup), and map `scope` → existing capability scopes. `/api/mcp` and `/api/v1/*` get OAuth + API-key dual auth for free.

`WWW-Authenticate` header on 401: `Bearer realm="dreyv", as_uri="${origin}/.well-known/openid-configuration", resource="${origin}/api"` so MCP clients discover and trigger DCR automatically.

## Consent screen

`src/app/oauth/consent/page.tsx` — server component reading signed `request_id` cookie set by `GET /authorize`. Shows client name, requested scopes with human labels (`treasury:read` → "View your treasury data"), allow / deny buttons. Approving writes to `oauth_consents` and 302s with the code. Light Stitch-style design matching `/pricing` (white, violet accents, Manrope).

`src/app/oauth/device/page.tsx` — user-code entry + same consent UI.

## Files to add

```text
supabase/migrations/<ts>_oauth_server.sql        schema + RLS + grants
src/lib/oauth/keys.ts                            ES256 keypair load + rotate + encrypt
src/lib/oauth/store.ts                           Drizzle queries for all oauth_* tables
src/lib/oauth/tokens.ts                          sign/verify JWT, hash, rotation
src/lib/oauth/scopes.ts                          scope catalog + human labels
src/lib/oauth/pkce.ts                            S256 verify
src/lib/oauth/session.ts                         resolve current dreyv user from SIWS/Neon cookies
src/lib/oauth/clients.ts                         registration + lookup + rate limit
src/lib/auth/bearer.ts                           extend to accept OAuth JWTs
src/app/api/oauth/register/route.ts
src/app/api/oauth/authorize/route.ts             GET + POST
src/app/api/oauth/token/route.ts
src/app/api/oauth/device/route.ts
src/app/api/oauth/introspect/route.ts
src/app/api/oauth/revoke/route.ts
src/app/api/oauth/userinfo/route.ts
src/app/.well-known/jwks.json/route.ts
src/app/oauth/consent/page.tsx
src/app/oauth/device/page.tsx
scripts/rotate-oauth-keys.mjs
```

Existing `/.well-known/openid-configuration` and `/oauth-protected-resource` already advertise these URLs — no change needed there.

## Out of scope (follow-ups)

- Admin UI to list/revoke a user's authorized clients (will live at `/app/settings/connected-apps`).
- Refresh-token sliding-window UI.
- SAML/social IdP login for the consent screen (uses existing dreyv auth only).
- `mTLS` and `private_key_jwt` client auth — defer until a partner needs it.

## Acceptance

1. `curl -X POST /api/oauth/register -d '{"redirect_uris":["http://localhost/cb"]}'` returns a client.
2. Browser flow: `/authorize?...&code_challenge=...` → login → consent → 302 with `code` → `POST /token` returns JWT.
3. `Authorization: Bearer <jwt>` works against `/api/mcp` and `/api/v1/*`.
4. Refresh rotates and revokes the chain on reuse.
5. Device flow: Claude Desktop / ChatGPT MCP connector completes registration and login end-to-end.
6. `/revoke` immediately invalidates the token in `/introspect` and on the next API call.
