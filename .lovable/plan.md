# /treasury — Research-first rebuild as the agent-extensible foundation

The current `/app/treasury` is a pretty placeholder with mock holdings/trend/suggestions. Before any code we do real research, then ship a foundation page that the existing **DACS agent system + Canvas + CommandBar** can stream content into — instead of hardcoding 6 dashboard sections we'll never finish.

## Design rules (locked, from memory)

- Stitch-light, white bg, solid violet `#7c3aed`, Manrope, ambient violet glows, violet-200 borders, flat violet CTAs. **No** gradients, fuchsia/pink, dark mode, or generic stock icons.
- Generative + streaming: numbers count up, sections stream in, charts animate. Never grid-y or static.
- **Hide all technical chrome** — no agent IDs, tick counters, JSON, terminals, "decisions" panels. Speak in human outcomes ("Dreyv noticed…").
- **No mock/demo numbers ever.** Empty/unconnected state must clarify (connect wallet, paste address) — not invent figures.
- Same brand language as `/pricing`, `/waitlist`, `/`, `/app`.

## Phase 1 — Research (no code)

I'll do this with the websearch + perplexity tools and write the findings to `mem://research/treasury-landscape` so the build phase has a single source of truth.

**Competitor scan** (treasury surface coverage, NOT visual copy):
- Squads, Realms, Parcl Treasury, Utopia Labs, Coinshift, Multis, Den, Llama (Karpatkey), Safe{Wallet} apps, Superfluid, Sablier, Request Finance, Gnosis Pay, Mean Finance, Streamflow, Lulo, Drift Vaults.
- For each: capture features they ship under our 6 user-named buckets, pricing/positioning, what users complain about (Reddit/Twitter/G2).

**User-need scan** (what treasurers actually want — DAO ops, crypto-native CFOs, Solana foundations, agencies on payroll):
- Forum threads (Realms, Squads), DAO ops job posts, Karpatkey/Steakhouse reports, Messari/Delphi treasury reports, recent (2025-2026) posts on agentic treasury.

**Output**: a synthesis matrix — `feature × competitor coverage × user demand × Dreyv differentiator (agentic/autonomous)` saved to memory + a short "what to build first vs later" ranking under each of the 6 user buckets:
1. Tokens in the treasury (holdings, valuation, provenance)
2. Mass send-outs (payroll, airdrops, grants)
3. Payments & Treasury Operations (recurring, invoices, gas tank)
4. Governance & Reporting (proposals, burn statements, exports)
5. Accounting & Financial Controls (policy, allowlists, approvals, audit)
6. DeFi & Treasury Management (yield, hedging, rebalancing, liquidations)
7. Wallet & Asset Security (multisig, signers, attestations, key hygiene)

I'll present the synthesis back before writing code so you can shape priorities.

## Phase 2 — What we already have (audit, no rewrites)

We will **not** rebuild the agent system. Foundation reuses:

- **Capability registry** (`src/lib/agents/capabilities/*`) — 48 capabilities across `treasury / trading / yield / payments / policy / risk / intel / studio / dynamic / misc / deliverables / research-brief`. Already covers most of the 6 buckets (mass_dispatch, runway autopilot, gas-tank watcher, grants watcher, liq watcher, burn statement cron, streamflow reconcile, tax-lot engine, drift hedge, etc.).
- **DACS pipeline** — intent → plan → HITL → executor → episodes → post-mortem; specialists (treasury / trading / yield / payments / policy / risk / research / builder / navigator) with CATP v1.0 handoff envelope; sub-agent runtime for watchers.
- **Canvas** (`src/lib/canvas`, `src/components/canvas`) — `CanvasBlock` primitive (narrative/metric/chart/plan/watcher/suggestion/artifact/research-brief) is **already** the generative-UI substrate. CommandBar + agents already emit blocks via the bus bridge.
- **App-shell primitives** — `AmbientGlow`, `Surface`, `StreamIn`, `StreamingNumber`, `Composition`, `SuggestionList`, `NarrativeStream`, `TreasuryPulseCarousel`.

So: don't invent a new dashboard framework — make `/treasury` a Canvas surface scoped to treasury intent, with skeleton "rails" that the registry's capabilities + specialists fill in dynamically.

## Phase 3 — Foundation build (after research approval)

### Page architecture

```text
/app/treasury (Canvas surface, scope="treasury")
├── Hero rail        → live valuation, 24h move, composition strip (real data only)
├── Pulse rail       → streamed narratives from sub-agents (runway, gas, liq, grants)
├── Action rail      → CommandBar dock, scoped to treasury intents
├── Canvas stream    → blocks emitted by agents/CommandBar/capabilities
└── Suggestion rail  → policy-derivation + research-brief outputs
```

No hardcoded "Payroll" / "Governance" / "Accounting" sections. Each bucket is **a set of capability tags** the registry already owns; a bucket renders only when there's a real block, watcher, or suggestion to show. Empty buckets show a single "Ask Dreyv to set this up" affordance that opens CommandBar pre-filled — never mock numbers.

### CommandBar ↔ agents ↔ canvas wiring (already exists; we formalise)

```text
User types in dock  ──►  agent.command.submitted
                            │
                  intent.classified (DACS)
                            │
                   plan.synthesized  ──►  Canvas: "plan" block (streaming)
                            │
                   handoff.requested ──►  specialist runs
                            │
                   handoff.reported  ──►  Canvas: "capability-result" / "narrative" / "artifact"
                            │
                   approval.requested ──►  HITL chip inside the block (no separate modal)
```

The block renderer (`CanvasBlockView`) already supports these payload kinds. We add **treasury-scoped renderers** for the bucket-specific outputs (e.g. mass-dispatch preview, runway curve, allowlist diff, burn statement, hedge plan) — each a small, branded component that streams in.

### Empty / not-connected state

Instead of fake $X numbers: a violet ambient hero with one CTA — `Connect a wallet` or `Paste an address to preview` — and 3 example prompts that route through CommandBar so even the empty state demos the agentic flow.

### What we explicitly do NOT build now

- The 6 buckets as static UI sections.
- Any new agent runtime, bus, or capability schema.
- Any tab/sidebar/module pattern (violates app-shell rules).
- Anything visual borrowed from current toast notifications or generic icon sets.

## Technical notes

- New file: `src/components/treasury/TreasurySurface.tsx` — Canvas-backed page body, wraps `CanvasProvider` with `scope="treasury"`.
- New renderers under `src/components/canvas/blocks/treasury/` for bucket-specific block payloads (mass-dispatch preview, runway curve, allowlist diff, burn statement, hedge plan, gas-tank status). Each ≤ ~150 lines, uses existing primitives.
- New: `src/components/treasury/TreasuryCommandDock.tsx` — CommandBar instance pre-scoped to treasury intents (filters capability suggestions by `domain ∈ {treasury, payments, policy, risk, yield}`).
- Replace `src/app/app/treasury/page.tsx` body with `<TreasurySurface />`. Header/glow/typography stay identical to current page (already on-brand).
- Reuse `useVault`, `useTreasuryTrend`, capability registry, DACS bus events. **Do not** touch DACS internals, registry shape, or canvas types.
- Memory file to add after research: `mem://research/treasury-landscape` (competitor matrix + user-need ranking + bucket priorities).

## Deliverable order

1. Research synthesis → present back, you approve priorities.
2. Foundation page (Canvas surface + dock + empty state + 2-3 reference block renderers).
3. Iterate: add remaining bucket renderers as we wire each capability into the dock's suggestion list.

Awaiting approval to start Phase 1 (research) — no code until you've seen the synthesis.
