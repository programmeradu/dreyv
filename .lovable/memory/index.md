# Project Memory

## Core
Brand color is SOLID violet only (`violet-600` / `#7c3aed` aka `aurora-violet`). NEVER use fuchsia, pink, or gradients (no `from-violet-* to-fuchsia-*`, no `bg-gradient-*`). Solid fills only.
DEFAULT THEME for every new public/marketing/dev page = Stitch-inspired premium LIGHT (white bg, Manrope, solid violet accents, ambient violet-400/300 glows, violet-200 borders). NEVER ship a dark/generic first draft and wait for the user to ask for a redesign — match `/pricing` aesthetic from the first pass.
For "premium icons" the user wants custom generated/illustrated marks (e.g. 3D violet crystal renders via imagegen), not stock Lucide/Heroicons reused across the app. No common stock iconography on marketing pages.
Pricing tiers: Free $0, Mini $49/mo, Max $199/mo (FastSpring MoR). Keep marketing pricing in sync with this.
Approved pricing page aesthetic: white bg, solid violet accents, ambient violet-400/300 glows, manrope, custom crystal tier images, solid violet "Most popular" border + flat violet CTA strip — replicate this style for other marketing pages.
NEVER use hardcoded/demo/made-up figures (e.g. "$100k portfolio", "$250k AUM", default amounts) in any simulation, plan, or projection. Every prompt must either run on live data, or clarify (LLM-driven) to ask the user for the missing exposure (connect wallet / paste address / enter amount / explicit demo opt-in). Bad marketing otherwise.
Two-track front door: `/waitlist` (gated, qualified — primary marketing CTA) + `/auth` Free tier (self-serve, stays discoverable). Never gate Atlas read-only / `/compare` / `/developers` / `llms*.txt` / OpenAPI.
`/app/analytics` is an analytics page FIRST (real data, smart/reactive/suggestive by default) — sim/IR regeneration is an overlay only, never the default surface.
On /app/analytics: FLAT only — no shadows, no backdrop-blur, no gradients, no ring/elevation. Cards = `rounded-3xl border border-violet-100 bg-white`. Stream numbers, chart paths, narratives, and suggestions. Cover ALL analytics (value, PnL, attribution, composition, concentration, runway, drift, foresight, DeFi, fees, benchmark, flows, anomalies, suggestions).
Dreyv brand voice (for any AI-generated copy): calm, precise, founder-to-founder. NO emoji-spam, NO hashtags on X, NEVER "revolutionize/game-changer/synergy/disrupt/next-gen/leverage(verb)/supercharge". Pronunciation: DRAVE.
Lovable AI (`LOVABLE_API_KEY`) is ALWAYS called via a Supabase edge function in the Lovable Cloud workspace — never directly from Vercel. Never migrate existing Groq/CF/OpenAI providers; only ADD Lovable AI as an extra provider in the loop.
Brand mascot = **Dryv** (owl-fox sentinel, solid violet). Pose set in `src/assets/mascot/`. Use for empty states, success, alerts, marketing — never re-generate without matching existing silhouette/palette.

## Memories
- [Waitlist](mem://features/waitlist) — `/waitlist` invite-only signup, AUM bands, status state machine, cohort cadence, admin pipeline.
- [Analytics page](mem://features/analytics-page) — Default analytics layer + scenario overlay rules; IR is for regeneration, not the page itself.
- [Analytics design rules](mem://design/analytics-rules) — Flat surfaces, streaming generative UI, full-coverage reporting list.
- [Media Studio](mem://features/media-studio) — Internal team-only `/app/studio/media`; generation routes, access rules, brand voice constants, R2 persistence.
- [Lovable AI routing](mem://constraints/lovable-ai-routing) — All Lovable AI calls go through a Supabase edge function; never migrate existing providers, only add.
- [Dryv mascot](mem://design/mascot) — Owl-fox treasury sentinel, 4-pose set, palette + usage rules.
