# Project Memory

## Core
Brand color is SOLID violet only (`violet-600` / `#7c3aed` aka `aurora-violet`). NEVER use fuchsia, pink, or gradients (no `from-violet-* to-fuchsia-*`, no `bg-gradient-*`). Solid fills only.
DEFAULT THEME for every new public/marketing/dev page = Stitch-inspired premium LIGHT (white bg, Manrope, solid violet accents, ambient violet-400/300 glows, violet-200 borders). NEVER ship a dark/generic first draft and wait for the user to ask for a redesign — match `/pricing` aesthetic from the first pass.
For "premium icons" the user wants custom generated/illustrated marks (e.g. 3D violet crystal renders via imagegen), not stock Lucide/Heroicons reused across the app. No common stock iconography on marketing pages.
Pricing tiers: Free $0, Mini $49/mo, Max $199/mo (FastSpring MoR). Keep marketing pricing in sync with this.
Approved pricing page aesthetic: white bg, solid violet accents, ambient violet-400/300 glows, manrope, custom crystal tier images, solid violet "Most popular" border + flat violet CTA strip — replicate this style for other marketing pages.
NEVER use hardcoded/demo/made-up figures (e.g. "$100k portfolio", "$250k AUM", default amounts) in any simulation, plan, or projection. Every prompt must either run on live data, or clarify (LLM-driven) to ask the user for the missing exposure (connect wallet / paste address / enter amount / explicit demo opt-in). Bad marketing otherwise.
Two-track front door: `/waitlist` (gated, qualified — primary marketing CTA) + `/auth` Free tier (self-serve, stays discoverable). Never gate Atlas read-only / `/compare` / `/developers` / `llms*.txt` / OpenAPI.
/app/treasury is a Canvas surface scoped to treasury intent (4 rails: Hero/Pulse/Action/Stream) — never fixed bucket sections. Buckets render only when an agent/watcher/capability has a real block to show. Empty buckets show "Ask Dreyv to set this up" opening CommandBar pre-filled. Reuse DACS pipeline + capability registry + Canvas + app-shell primitives — do not invent new agent or dashboard frameworks.
ALWAYS use real logos (token/protocol/company) via real image URLs. Never letter-circle or initial placeholders. Forward `logo` field through canvas payloads; render with `<TokenAvatar>` (its geometric sigil is the only acceptable fallback).

## Memories
- [Waitlist](mem://features/waitlist) — `/waitlist` invite-only signup, AUM bands, status state machine, cohort cadence, admin pipeline.
- [Treasury landscape research](mem://research/treasury-landscape) — Apr 2026 competitor matrix (Squads/Realms/Coinshift/Utopia/Multis/Karpatkey/Sablier/etc), user-need ranking, Dreyv agentic differentiator, bucket priorities for `/app/treasury` foundation.
- [Real logos rule](mem://design/real-logos) — How to wire real token/protocol/company logos; never use initial-circle placeholders.
