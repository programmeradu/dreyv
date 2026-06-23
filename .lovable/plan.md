# Plan: OAuth 2.1 + DCR Server + Agent Discovery Additions

Combines the previously-approved OAuth 2.1 / DCR build with six new agent-readiness scanner fixes.

---

## Part A — OAuth 2.1 + Dynamic Client Registration (unchanged)

Build a real OAuth server so Claude, ChatGPT, Cursor and other MCP clients can self-register and obtain tokens against `dreyv.com`.

### Endpoints (`src/app/api/oauth/*`)
- `POST /register` — RFC 7591 Dynamic Client Registration
- `GET|POST /authorize` — authorization-code + PKCE, with consent screen
- `POST /token` — `authorization_code`, `refresh_token`, `client_credentials`, `urn:ietf:params:oauth:grant-type:device_code`
- `POST /device` — RFC 8628 device-code flow
- `POST /introspect` — RFC 7662
- `POST /revoke` — RFC 7009
- `GET /.well-known/jwks.json` — public ES256 keys

### Schema (`dreyv_oauth` schema in Neon)
- `oauth_clients` (`client_id`, `client_secret_hash`, `grant_types`, `response_types`, `token_endpoint_auth_method`, redirect URIs, owner)
- `oauth_auth_codes` (10-min, `code_challenge`, `code_challenge_method`, `scope`, `user_id`)
- `oauth_tokens` (JWT id + hash, `parent_refresh_hash` for refresh rotation, scopes, revoked_at)
- `oauth_device_codes` (15-min, `user_code`, `approved_user_id`)
- `oauth_signing_keys` (ES256 keypair, private key encrypted with `KEYPAIR_MASTER_KEY`)
- `oauth_consents` (skip consent on re-auth per `client_id` + `user_id` + scope set)

### Library code
`src/lib/oauth/{keys,store,tokens,scopes,pkce,session,clients,bearer}.ts` — key mgmt with `getActiveSigner()` / `getVerifierKeySet()`, rotation script `scripts/rotate-oauth-keys.mjs`.

### Integration
- Extend `src/lib/auth/bearer.ts` to accept OAuth JWTs alongside `dk_live_*` API keys
- Add `WWW-Authenticate: Bearer resource_metadata=...` on 401 from `/api/mcp` and `/api/v1/*`
- Map OAuth scopes → existing `ApiScope` enum so route guards are unchanged

### UI
- `/oauth/consent` — consent screen bound to SIWS / Neon Auth session
- `/oauth/device` — user-code entry page for device flow

### Out of scope (follow-up)
Admin UI for connected apps, automated rotation cron, mTLS, `private_key_jwt`.

---

## Part B — Agent Discovery Additions (NEW)

Six scanner-driven additions to make `dreyv.com` fully agent-ready.

### B1. DNS-AID (DNS for AI Discovery)
- Add a publishable zone snippet at `public/.well-known/dns-aid/zone.txt` with SVCB/HTTPS records, e.g.
  - `_index._agents.dreyv.com. 3600 IN HTTPS 1 dreyv.com. alpn="h2,http/1.1" endpoint="/.well-known/agents.json"`
  - `_a2a._agents.dreyv.com.   3600 IN HTTPS 1 dreyv.com. alpn="h2"        endpoint="/.well-known/a2a.json"`
  - `_mcp._agents.dreyv.com.   3600 IN HTTPS 1 dreyv.com. alpn="h2"        endpoint="/api/mcp"`
  - `_acp._agents.dreyv.com.   3600 IN HTTPS 1 dreyv.com. alpn="h2"        endpoint="/.well-known/acp.json"`
- Document DNSSEC enablement in `docs/dns-aid.md` (operator step on Vercel DNS / registrar — not code).
- Surface the same SVCB records in JSON at `/.well-known/dns-aid` for HTTP-based scanners.

### B2. Markdown for Agents (content negotiation)
- New `src/middleware/markdown.ts` helper invoked from `src/middleware.ts`: when request `Accept` includes `text/markdown` and the route is HTML, rewrite to the existing page's `.md` sibling (e.g. `/pricing` → `/pricing.md`) or proxy through `/api/agents/markdown?path=...`.
- Implement `src/app/api/agents/markdown/route.ts`: fetches the rendered HTML internally, runs through `turndown`, returns `Content-Type: text/markdown; charset=utf-8` + `x-markdown-tokens` header (approx via `gpt-tokenizer`).
- Whitelist marketing/docs routes: `/`, `/pricing`, `/developers`, `/api-docs`, `/mcp`, `/case`, `/legal/*`, `/atlas`, `/compare`.

### B3. Auth.md
- Update `src/app/auth.md/route.ts` to start with `# Auth.md` heading and follow WorkOS spec: list register_uri, supported identity types (`user`, `agent`), credential types (`oauth2`, `api_key`), claim URL, revocation URL, contact.
- Augment `src/app/.well-known/oauth-authorization-server/route.ts` with an `agent_auth` block:
  ```json
  {
    "agent_auth": {
      "register_uri": "https://dreyv.com/api/oauth/register",
      "identity_types": ["user","agent"],
      "credential_types": ["oauth2","api_key"],
      "claim_uri": "https://dreyv.com/auth?agent=1",
      "revocation_uri": "https://dreyv.com/api/oauth/revoke"
    }
  }
  ```
- Ensure `/.well-known/oauth-protected-resource` advertises both the AS metadata URL and `resource_documentation: https://dreyv.com/auth.md`.

### B4. WebMCP
- Update `src/components/agent/WebMCPProvider.tsx` to register real tools via `navigator.modelContext?.provideContext(...)`:
  - `search_atlas({ query })` → routes to `/api/atlas/search`
  - `get_pricing()` → returns the tier JSON
  - `start_waitlist({ email, aum_band })` → POST `/api/waitlist`
  - `get_portfolio_snapshot({ address })` → GET `/api/v1/portfolio/:address`
- Feature-detect, no-op gracefully when API absent.

### B5. x402 (agent-native HTTP payments)
- Add `src/lib/x402/middleware.ts` (lightweight; no `@x402/next` dep — implement the 402 challenge spec directly: facilitator URL, accepted asset list, wallet receiver address).
- Protect a small, well-defined surface first:
  - `GET /api/v1/atlas/deep/:address` — premium deep scan
  - `GET /api/v1/insights/:address` — full insight stream
- Env: `X402_FACILITATOR_URL`, `X402_RECEIVER_ADDRESS`, `X402_ASSET` (default USDC base-mainnet). Use `secrets--add_secret` for values.
- Document at `/api-docs` under "Agent-native payments".

### B6. ACP discovery (`/.well-known/acp.json`)
- New `src/app/.well-known/acp.json/route.ts`:
  ```json
  {
    "protocol": { "name": "acp", "version": "0.3" },
    "api_base_url": "https://dreyv.com/api/v1",
    "transports": ["https","mcp"],
    "capabilities": {
      "services": [
        { "id": "atlas", "kind": "analytics", "endpoint": "/atlas" },
        { "id": "insights", "kind": "insights", "endpoint": "/insights" },
        { "id": "pricing", "kind": "commerce", "endpoint": "/checkout" }
      ]
    },
    "auth": { "oauth2": "https://dreyv.com/.well-known/oauth-authorization-server" }
  }
  ```
- Add to `src/app/sitemap.ts` and link from `/developers`.

---

## Sequencing
1. Part A schema + JWKS + `/authorize` + `/token` (auth-code+PKCE & client-credentials) + DCR + `/revoke`.
2. Part A device-code + introspection.
3. Part B6 (ACP) → B3 (Auth.md polish) → B1 (DNS-AID) → B4 (WebMCP tools) → B2 (Markdown for Agents) → B5 (x402).
4. Update `public/llms.txt`, `public/llms-full.txt`, `public/developers/llms.txt`, `src/app/robots.txt/route.ts`, `src/app/sitemap.ts`, and `src/components/home/site-footer.tsx` to advertise the new endpoints.

## Out of scope
DNSSEC enablement at the registrar, real x402 facilitator deployment (use Coinbase hosted facilitator), admin UI for OAuth clients.
