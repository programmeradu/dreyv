# Agent Pipeline — End-to-End

Goal: an autonomous AI agent can, without any human in the loop, create a Dreyv account, subscribe to a tier, mint its own scoped API key, and call every product capability over MCP / REST — using only the standards we already advertise (auth.md, OAuth 2.1 DCR, ACP, x402, MCP).

## What exists today
- Discovery surface complete: `acp.json`, `x402`, `oauth-authorization-server`, `oauth-protected-resource`, `openid-configuration`, `jwks.json`, `http-message-signatures-directory`, `auth.md`, `agent-skills`, DNS-AID.
- DB: `oauth_server` (clients, tokens, codes), `public_api_keys`, `agent_x402`, `agent_payments` multirail, `agent_wallets`, `agent_deliverables`.
- Routes: `/api/oauth/{register,authorize,token,revoke,introspect,userinfo,device}`, `/api/x402/echo`, `/api/mcp` (subset of tools).
- Stripe + Paystack checkout (browser redirect only).

## What's missing (the four gaps)
1. **Machine signup** — no way for an agent holding only a wallet / DID to provision a Dreyv user row without a human SIWS or Google OAuth click.
2. **ACP-native subscribe** — `/api/mcp` and checkout don't expose an ACP `checkout` capability that flips `users.tier` after payment (Stripe / Paystack / x402 USDC).
3. **Programmatic key issuance** — agents holding an OAuth access token can't mint a `dk_live_…` API key for themselves; only the human `/app/settings/api` UI does it.
4. **Capability coverage** — `/api/mcp` lists only a handful of tools; Atlas, Foresight, Vault ops, Treasury actions, Studio, Insights are not registered as MCP tools, and most are not gated/metered via x402.

## Plan

### Phase 1 — Machine signup (`POST /api/agents/signup`)
- Accept one of: (a) OAuth DCR client + `client_credentials` token, (b) signed Web Bot Auth request (HTTP Message Signatures verified against caller's published JWKS), (c) wallet signature (SIWS / SIWE) without browser.
- Creates: `users` row (`tier=free`, `is_agent=true`, `agent_owner_did`), `oauth_clients` row, default `public_api_keys` row scoped `mcp` only.
- Returns `{ user_id, client_id, client_secret, api_key, scopes, tier }`.
- Rate-limited per source IP + per Web Bot Auth key id; abuse tracked in `agent_signup_audit`.
- Documented in `auth.md` and the ACP `agent_auth.register_uri`.

### Phase 2 — ACP subscribe capability (`POST /api/acp/checkout`)
- Implements ACP `checkout` service: accepts `{ tier: mini|max, payment: { provider: stripe|paystack|x402, ... } }`.
- Three payment paths:
  - `stripe` → creates Checkout Session, returns hosted URL (human-finishable) **and** PaymentIntent for ACP `delegate_payment` flow.
  - `paystack` → creates transaction init, returns authorization URL.
  - `x402` → returns 402 with `accepts` for one-shot USDC on base; on successful payment proof verification, flips tier immediately (no human step). This is the only fully-agentic rail.
- Webhook (`/api/webhooks/{stripe,paystack}`) and x402 settlement both call `upgradeUserTier(userId, tier)` — single source of truth.
- Adds `acp.json` `capabilities.services` already includes `"checkout"`; add `"orders"` + `"delegate_payment"` once Stripe Agentic Commerce SDK is wired.

### Phase 3 — Programmatic key issuance (`POST /api/keys`)
- Auth: OAuth access token with scope `keys:write` (granted to agents via DCR), or existing `api_key` with `keys:write`.
- Creates a scoped `public_api_keys` row; returns `dk_live_…` exactly once.
- Sister routes: `GET /api/keys` (list, redacted), `DELETE /api/keys/:id` (revoke), `POST /api/keys/:id/rotate`.
- Audit row in existing `public_api_safety` tables.
- Documented in `auth.md` step "Mint API key (programmatic)".

### Phase 4 — MCP capability coverage + x402 metering
- Register every product capability as an MCP tool in `/api/mcp` and in `agent-skills/index.json`:
  - `atlas.search`, `atlas.protocol`, `atlas.token`, `atlas.yield`
  - `foresight.simulate`, `foresight.regenerate`
  - `vault.read`, `vault.propose`, `vault.execute`
  - `treasury.payments.create`, `treasury.payroll.run`
  - `insights.daily`, `insights.anomalies`, `insights.opportunities`
  - `studio.generate` (media), `case.generate`
- Each tool declares: required scopes, pricing (`free` | `metered` with x402 `maxAmountRequired`).
- Middleware `withAgentAuth({ scope, x402 })` runs on each handler: validates Bearer (api_key or oauth_token), checks scope, debits credit OR returns 402 with payment requirements pointing at `/.well-known/x402` and the per-route price.
- `/.well-known/x402.resources` enumerated automatically from a single `agentCapabilities.ts` registry — keeps ACP and x402 in sync without conflation (ACP describes commerce semantics; x402 describes per-call settlement).

### Phase 5 — End-to-end conformance test
- `scripts/agent-e2e.mjs` runs the full flow against a deployed origin: DCR → signup → ACP checkout (x402 USDC) → key mint → MCP `tools/list` → call one paid tool (Atlas) → call one free tool → revoke.
- Wired into CI as a smoke test against preview deploys.

## Technical details

```text
Agent                       Dreyv
 │  GET /.well-known/oauth-authorization-server
 │ ─────────────────────────────────────────────▶
 │  POST /api/oauth/register  (DCR, RFC 7591)
 │ ─────────────────────────────────────────────▶ oauth_clients
 │  POST /api/agents/signup   (Web Bot Auth sig + client_id)
 │ ─────────────────────────────────────────────▶ users(tier=free,is_agent=true)
 │  POST /api/acp/checkout    {tier:"mini", payment:{x402}}
 │ ◀──────────── 402 + accepts (USDC base) ─────
 │  POST /api/acp/checkout    + X-PAYMENT
 │ ─────────────────────────────────────────────▶ verify → users.tier=mini
 │  POST /api/keys            scope=keys:write (oauth token)
 │ ◀──────────── dk_live_… ──────────────────────
 │  POST /api/mcp             tools/list
 │  POST /api/mcp             tools/call atlas.search
 │ ◀──────────── 402 if metered, else 200 ──────
```

Files added:
- `src/lib/agent/registry.ts` — single capability registry (id, scopes, price, handler).
- `src/lib/agent/middleware.ts` — `withAgentAuth({scope, x402})`.
- `src/lib/agent/x402-verify.ts` — verifies `X-PAYMENT` against base-sepolia facilitator.
- `src/app/api/agents/signup/route.ts`
- `src/app/api/acp/checkout/route.ts`
- `src/app/api/keys/route.ts`, `src/app/api/keys/[id]/route.ts`, `src/app/api/keys/[id]/rotate/route.ts`
- `src/app/api/mcp/route.ts` — expanded to read from registry.
- `db-migrations/0049_agent_signup_audit.sql`
- `scripts/agent-e2e.mjs`

Files edited:
- `src/app/.well-known/x402/route.ts` — resources auto-generated from registry.
- `src/app/.well-known/acp.json/route.ts` — add `orders`, `delegate_payment` once Stripe ACS SDK lands (Phase 2.5).
- `src/app/auth.md/route.ts` — add machine-signup + programmatic-key sections.
- `public/.well-known/agent-skills/index.json` — full capability index.

## Order of build
1. Capability registry + middleware (foundation everything plugs into).
2. Phase 3 (`/api/keys`) — smallest, validates auth + scope plumbing.
3. Phase 1 (`/api/agents/signup`).
4. Phase 2 (`/api/acp/checkout`) — Stripe + Paystack + x402.
5. Phase 4 (expand MCP tools, route them through middleware).
6. Phase 5 (e2e script + CI).

## Out of scope (call out, not building now)
- Stripe Agentic Commerce SDK integration (separate plan once Stripe approves the account).
- Solana mainnet x402 (start on base-sepolia, mainnet after audit).
- Per-org agent fleets / delegated identities (Phase 6).
- Billing-portal style self-serve plan downgrade for agents (Phase 6).

Confirm to start at step 1 and I'll build it end-to-end.
