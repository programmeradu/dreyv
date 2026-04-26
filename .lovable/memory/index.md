# Project Memory

## Core
NEVER ship stubs in agent capabilities — no `Math.random()` IDs returned as real, no terminal `ARMED`/`DEFERRED_TO_INDEXER`/`NEEDS_PARSE`, no `compositeRisk: "UNKNOWN"`. Every capability must hit a real API/SDK/RPC, log to `agent_episodes`, and reconcile via Inngest within 60s. See `mem://preferences/no-stubs` + `.lovable/dacs-phase7-capability-audit.md`.
Agents must be able to do anything and everything in Dreyv and the treasury — if a tool/API/MCP/SDK is missing, we build and wire it (no stubs, no "pretend to work" implementations, ever).
Brand color is SOLID violet only (`violet-600` / `#7c3aed` aka `aurora-violet`). NEVER use fuchsia, pink, or gradients (no `from-violet-* to-fuchsia-*`, no `bg-gradient-*`). Solid fills only.
DEFAULT THEME for every new public/marketing/dev page = Stitch-inspired premium LIGHT (white bg, Manrope, solid violet accents, ambient violet-400/300 glows, violet-200 borders). NEVER ship a dark/generic first draft and wait for the user to ask for a redesign — match `/pricing` aesthetic from the first pass.
For "premium icons" the user wants custom generated/illustrated marks (e.g. 3D violet crystal renders via imagegen), not stock Lucide/Heroicons reused across the app. No common stock iconography on marketing pages.
Pricing tiers: Free $0, Mini $49/mo, Max $199/mo (FastSpring MoR). Keep marketing pricing in sync with this.
Approved pricing page aesthetic: white bg, solid violet accents, ambient violet-400/300 glows, manrope, custom crystal tier images, solid violet "Most popular" border + flat violet CTA strip — replicate this style for other marketing pages.
NEVER use hardcoded/demo/made-up figures (e.g. "$100k portfolio", "$250k AUM", default amounts) in any simulation, plan, or projection. Every prompt must either run on live data, or clarify (LLM-driven) to ask the user for the missing exposure (connect wallet / paste address / enter amount / explicit demo opt-in). Bad marketing otherwise.
Two-track front door: `/waitlist` (gated, qualified — primary marketing CTA) + `/auth` Free tier (self-serve, stays discoverable). Never gate Atlas read-only / `/compare` / `/developers` / `llms*.txt` / OpenAPI.
DACS migration is the active backend refactor — `.lovable/plan.md` is canonical. Phase 0 done (48 capabilities). Phase 1 next: intent → plan → route → sse-proxy. Always re-read plan before DACS work.
Canonical production domain is **dreyv.com** (org owns dreyv.com / dreyv.app / dreyv.finance). NEVER use `dreyv.stauniverse.tech` in code, copy, emails, OG images, docs, or env defaults — always default to `https://dreyv.com`.

## Memories
- [Waitlist](mem://features/waitlist) — `/waitlist` invite-only signup, AUM bands, status state machine, cohort cadence, admin pipeline.
- [DACS](mem://features/dacs) — CommandBar → bus-driven agent pipeline, 6 phases, capability registry (48 caps), HITL, shadow rollout. Source of truth is `.lovable/plan.md`.
- [No stubs](mem://preferences/no-stubs) — Hard rule: no fake IDs, no ARMED-only states, no DEFERRED placeholders. Real calls only.
- [Phase 7 audit](file://.lovable/dacs-phase7-capability-audit.md) — Per-capability REAL/PARTIAL/STUB status + integration table + 4-day wire-up plan (Deliverables, Payments, Risk, Policy, Sniper/Sentiment, Scheduled).
