# /app Audit Remediation Plan (19 items)

Ordered by blast radius. Each phase is independently shippable.

## Phase 1 — Critical: stop lying to users (4)

1. **`api/agentic/history`** — replace stub with real query against `agent_executions` (or nearest existing table). If no table exists yet, DELETE the route and remove callers rather than return fake `[]`. Per `no-api-fallbacks` constraint.
2. **`/app/developer` L65–66** — replace hardcoded `"323 tools" / "120 req/min"` with values from `/api/v1/capabilities` count + the actual rate-limit config (`RATE_LIMIT_RPM` or key's `rateLimitRpm`). Skeleton while loading.
3. **`/app/status` + `/app/status/[id]`** — swap all `acme*` / `example.com` / `ops@acme.com` placeholders for neutral copy (`"my-api"`, `"My API Status"`, `"alerts@yourcompany.com"`, `"https://…"`).
4. **`/app/approve/[id]` L136** — remove `placeholder="000000"`; use empty placeholder + `aria-label="6-digit approval code"`.

## Phase 2 — Major: complete or gate silently-broken features (8)

5. **`api/studio/marketplace/register`** — either (a) implement the Turnkey/wallet-signed `initialize_app` tx, or (b) return HTTP 501 with clear message and mark the UI button "Coming soon" until (a) lands. No fake `status: "pending"`.
6. **`/app/studio/media`** — fix `redirect("/studio")` → `redirect("/app/studio/media/…")` real target, or delete the redirect page and render `MediaStudioClient` directly.
7. **`/app/inbox` dispatchInstruction** — for `stake|unstake|deposit_yield|withdraw|rebalance`: build the real tx via existing Jupiter/Marinade/Streamflow helpers, OR reject with a clear toast ("Not yet supported — approve from mobile") instead of silently writing a memo.
8. **`cron/dca-execute` L110/236/285** — add pre-swap SOL/USDC balance check (abort with ledger entry if insufficient); wire Resend emails for success + failure using existing `EMAIL_FROM` and templates.
9. **`/app/workflows`** — add graceful "capability unavailable" empty state when `runCapability("workflows.list")` errors with `capability_not_registered`; add a nav entry under Studio.
10. **`/app/observability`** — same treatment: capability-unavailable empty state; add nav entry (admin-only if scoped).
11. **`/app/admin/**`** — add an "Admin" nav item in `src/app/app/layout.tsx` visible only when `user.role === "admin"`; fix the corrupted `href=n` in `admin/activity/page.tsx`.
12. **`/app/agents/claim`** — verify `/claim` exists; if not, either build it or redirect to `/app/agents` with a toast explaining the flow.

## Phase 3 — Hygiene: remove debug/duplicate surfaces (3)

13. **`/app/_mobile-scroll-test`** — delete the folder (or gate behind `process.env.NODE_ENV !== "production"`).
14. **`/app/test-error`** — delete (error boundary is already tested by real errors).
15. **`/app/billing` vs `Settings → Billing`** — pick canonical: keep `/app/billing` as the full page, make the Settings tab a link to it (or vice versa). Update all internal links.

## Phase 4 — Polish: honest empty states (4)

16. **`/app/analytics` trend fallback** — when `displayValueSeries.length < 2`, render "Not enough history yet — check back after your next snapshot" instead of a synthetic 5-point sparkline.
17. **`/app` `TreasuryBubbles`** — replace hardcoded SOL/USDC/JUP/BONK/JTO with a "Connect wallet to see holdings" state; when connected but empty, show "No tokens detected".
18. **`ActivityTicker`** — either fetch real events from `agent_deliverables`/marketplace install log, or hide the ticker until an events source exists. No index-cycled fake verbs.
19. **`/app/run/[appId]`** — when `project == null` after load, render `notFound()` (Next.js 404) with a link back to `/app/marketplace`.
20. **`settings/BillingView` TIER_META** — move tier feature lists to `src/lib/billing/tiers.ts` (single source of truth already used by `/pricing`) and import in both places.

## Technical notes

- Nav changes go in `src/app/app/layout.tsx` L64–76 — respect existing ordering (Dashboard, Studio, Marketplace, Library, Treasury, Analytics, Team, Settings).
- Any new "capability unavailable" empty state should use a shared `<CapabilityGate capability="…">` component (create in `src/components/app/CapabilityGate.tsx`) to avoid copy-paste.
- All copy edits follow the Dreyv voice memory (calm, precise, no emoji, no "revolutionize").
- Do NOT introduce new stubs; per `no-api-fallbacks`, a missing capability must surface a real error, not a placebo response.

## Verification per phase

- Phase 1: grep for `acme|example\.com|323 tools|000000` under `src/app` → zero hits.
- Phase 2: manually exercise each route in Playwright, confirm no silent-success toasts on unimplemented paths.
- Phase 3: `rg "_mobile-scroll-test|test-error"` → zero hits.
- Phase 4: load `/app` with no wallet + `/app/analytics` with empty vault; screenshot both.
