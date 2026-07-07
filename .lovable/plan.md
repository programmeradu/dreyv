# Webacy Integration Plan

Ship in 5 phases behind a `WEBACY_ENABLED` flag. Every phase is independently deployable.

## Phase 0 — Foundation (shared plumbing)

**Secrets & config**
- Add `WEBACY_API_KEY` (server-only) via `add_secret`.
- Add `WEBACY_ENABLED` env flag (default `true` in prod, easy kill switch).

**Files**
- `src/lib/webacy/client.ts` — `webacyFetch(path, params)` wrapper: `x-api-key` header, 8s timeout, retries once on 5xx, structured error, never throws to callers (returns `{ ok:false, reason }`).
- `src/lib/webacy/cache.ts` — thin wrapper over existing Upstash Redis (already used by Colosseum cache). Keys: `wb:addr:{chain}:{addr}`, `wb:url:{sha1}`, `wb:tx:{hash}`. TTLs: addresses 6h, URLs 24h, tx sims 5m.
- `src/lib/webacy/types.ts` — normalized `RiskScore = { level: 'safest'|'safe'|'medium'|'low'|'high', numeric: number, flags: string[], source: 'webacy' }`.
- `src/lib/webacy/normalize.ts` — map each Webacy endpoint response → `RiskScore`.

**Proxy routes** (all server-side, `publicRateLimitOrResponse` capped; auth-gated for wallet-tied calls):
- `POST /api/webacy/address` — Contract Risk + Threat Risks fanned in parallel for a list of addresses.
- `POST /api/webacy/token` — Threat Risks for a mint.
- `POST /api/webacy/url` — URL Risk (batched).
- `POST /api/webacy/tx` — Transaction Risks (serialized tx or tx hash).
- `POST /api/webacy/exposure` — Exposure Risk for a wallet (auth required, wallet must be user's).
- `POST /api/webacy/approvals` — Approval Risks for a wallet.

**UI primitive**
- `src/components/webacy/RiskChip.tsx` — solid violet-token chip. Variants: `safest` (violet-100/violet-700), `safe` (violet-50/violet-600), `medium` (amber-50/amber-700), `low`/`high` (rose-50/rose-700). Tooltip shows top 3 flags + "Powered by Webacy". No emoji, no gradients, per project design core.
- `src/components/webacy/RiskDrillDown.tsx` — sheet that lists flagged items, one-click actions (revoke / open in Atlas / dismiss).

**Tests**
- Vitest for `normalize.ts` + `cache.ts`.
- Contract test that stubs `webacyFetch` and asserts every proxy route degrades gracefully when Webacy is down (must return `{ risk: 'unknown' }`, never 500).

---

## Phase 1 — Simulation Firewall pre-sign (highest value)

Integrate into `src/lib/studio/simulation-firewall.ts` + `src/app/api/firewall/check/route.ts`.

1. Collect every unique `programId` and writable destination pubkey from the deserialized instructions (reuse `flattenJupiterInstructions` + generic ix walker).
2. Parallel `POST /api/webacy/address` for the set.
3. Extend `FirewallReport` with `webacy: { worst: RiskLevel, addresses: RiskScore[] }`.
4. Policy (`src/lib/firewall/policy.ts`): add `maxAddressRisk` (default `medium`). Any `high` → `violations.push(...)`, `riskLevel = 'critical'`.
5. `WalletSigningDialog.tsx` — render `<RiskChip>` next to the fee row; if `high`, require two-tap confirm (button label flips to "I understand — sign anyway"; second click enables real sign).
6. Add tests to `policy.test.ts` covering `high address blocks`, `unknown address passes`, `medium address warns but passes`.

---

## Phase 2 — /app/approvals sweep view (killer standalone)

New route `src/app/app/approvals/page.tsx` (auth-gated).

- Server component fetches wallet's SPL token approvals via existing Helius client, then `/api/webacy/approvals` for enrichment.
- Client table: token, spender, amount, `<RiskChip>`, "Revoke" button.
- Revoke path reuses `use-wallet-transaction` + existing signing layer (builds an SPL `revoke`/`approve(0)` ix). Batch-revoke selects highest-risk first.
- Empty state + skeleton + error boundary.
- Add link in `src/components/app/AppSidebar` (or equivalent) under Security section.

---

## Phase 3 — Atlas + treasury exposure surfaces

**Wallet pages** `src/app/case/[address]/page.tsx`
- Server-side `/api/webacy/exposure`, render `<RiskChip>` next to balance header + a "2 holdings flagged" line linking to `RiskDrillDown`.

**Token pages** `src/app/atlas/tokens/[mint]/*`
- `<RiskChip>` in the title row via `/api/webacy/token`.

**Treasury dashboard** (`/app` header component)
- Soft violet card "Treasury exposure: {level} — N holdings flagged, review." → opens drill-down sheet.

**DCA flow** — in the DCA setup form, before submit call `/api/webacy/token`; if `medium`+, inline warning above the schedule button (non-blocking, one checkbox to acknowledge).

---

## Phase 4 — URL scanning (Inbox + agent knowledge)

- `src/lib/webacy/scan-urls.ts` — `scanUrls(urls: string[]): Promise<Map<string, RiskScore>>`, cached.
- `src/app/api/agent/knowledge/route.ts` — before fanning to Tavily/Jina/CF, scan `urlsInQuery`. Drop any `high`; annotate `medium` sources with a warning field in the response payload.
- Inbox render layer — replace bare `<a>` with `<SafeLink>` that blocks/warns on high risk before navigation. Server-side scan on ingest so we don't scan on every render.

---

## Phase 5 — DACS agent proposals + Holder Analysis

**Agent proposals**
- Extend the proposal builder to attach `webacy_tx_risk` (from `/api/webacy/tx` on the serialized tx) + `webacy_addresses`.
- Policy engine (`scripts/migrations/0011_dacs_phase2_hitl.sql` code path): if `webacy_tx_risk === 'high'`, force HITL even when auto-approve would otherwise apply.
- Proposal card component: `<RiskChip>` + reasons.

**Holder Analysis (invite-only)**
- Gate behind `WEBACY_HOLDER_ANALYSIS_ENABLED` (off by default until access granted via grant follow-up).
- Feed into existing rug detector as a `holderHealth` signal (bundling %, sniper %, top-10 concentration).
- New panel on `/atlas/tokens/[mint]` — "Distribution health".

---

## Rollout & safety

- Ship Phase 0 + Phase 1 first (best screenshot for the grant application follow-up).
- Every Webacy call is cached and fail-open on read (never blocks a page). The **only** fail-closed path is the Firewall policy for `high` addresses.
- Add a `webacy_calls` counter to existing analytics; alert if error rate > 5% over 15m.
- Attribution: single-line "Risk data by Webacy" footer in `RiskDrillDown` + `/app/approvals` per DD.xyz brand terms.

## Technical section

- No new dependencies — `webacyFetch` is plain `fetch` on Node runtime.
- Redis: reuse existing Upstash client at `src/lib/redis.ts`.
- All proxy routes use `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, and `publicRateLimitOrResponse({ max: 30, windowMs: 60_000 })`.
- Types flow: raw Webacy JSON → `normalize()` → `RiskScore` → UI. Never leak raw Webacy shapes past `src/lib/webacy/`.
- Design tokens: violet-only chips, no gradients, `DreyvStar` glyph for section markers, no `Sparkles`/`Zap` icons — per project core rules.
