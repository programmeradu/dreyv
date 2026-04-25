# Project Memory

## Core
Brand color is SOLID violet only (`violet-600` / `#7c3aed` aka `aurora-violet`). NEVER use fuchsia, pink, or gradients (no `from-violet-* to-fuchsia-*`, no `bg-gradient-*`). Solid fills only.
DEFAULT THEME for every new public/marketing/dev page = Stitch-inspired premium LIGHT (white bg, Manrope, solid violet accents, ambient violet-400/300 glows, violet-200 borders). NEVER ship a dark/generic first draft and wait for the user to ask for a redesign — match `/pricing` aesthetic from the first pass.
For "premium icons" the user wants custom generated/illustrated marks (e.g. 3D violet crystal renders via imagegen), not stock Lucide/Heroicons reused across the app. No common stock iconography on marketing pages.
Pricing tiers: Free $0, Mini $49/mo, Max $199/mo (FastSpring MoR). Keep marketing pricing in sync with this.
Approved pricing page aesthetic: white bg, solid violet accents, ambient violet-400/300 glows, manrope, custom crystal tier images, solid violet "Most popular" border + flat violet CTA strip — replicate this style for other marketing pages.
NEVER use hardcoded/demo/made-up figures (e.g. "$100k portfolio", "$250k AUM", default amounts) in any simulation, plan, or projection. Every prompt must either run on live data, or clarify (LLM-driven) to ask the user for the missing exposure (connect wallet / paste address / enter amount / explicit demo opt-in). Bad marketing otherwise.
Two-track front door: `/waitlist` (gated, qualified — primary marketing CTA) + `/auth` Free tier (self-serve, stays discoverable). Never gate Atlas read-only / `/compare` / `/developers` / `llms*.txt` / OpenAPI.
APP SHELL (`/app`, `/app/treasury`, `/app/analytics`) = generative + streaming UX. Hide ALL technical chrome (no agent IDs, no tick logs, no terminal feeds, no JSON, no monospace data tables). Speak in human outcomes. Match Stitch-light marketing DNA.
/api/command LLM provider order = Groq → Cloudflare Workers AI → Lovable AI Gateway (last-resort only). Never reorder without explicit approval.
CommandBar migration to DACS (bus-driven agent pipeline) is in progress — see [DACS](mem://features/dacs). Until Phase 6 cutover, every new capability MUST be added to `src/lib/agents/capabilities/*` registry, not inline in `src/app/api/command/route.ts`.

## Memories
- [Waitlist](mem://features/waitlist) — `/waitlist` invite-only signup, AUM bands, status state machine, cohort cadence, admin pipeline.
- [App shell aesthetic](mem://design/app-shell) — generative streaming UI rules for /app, /app/treasury, /app/analytics: hide agent internals, Stitch-light violet Manrope, human-outcome copy.
- [DACS](mem://features/dacs) — 6-phase migration of CommandBar from inline streamText+30 hardcoded tools to bus-driven agent pipeline (intent → plan → reflect → route). Locked decisions: full dynamic + HITL, per-user policy default-require-approval, shadow mode 1 week before cutover.
