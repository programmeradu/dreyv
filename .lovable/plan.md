## Why the current studio feels generic

- 8 fixed formats × fixed beat timings × fixed shot counts → every output is a fill-in-the-blank.
- Single LLM pass writes hook + script + shots in one go, no critique, no alternatives.
- No grounding: no real product surface, no real wallet/numbers, no signal from what's actually worked on your TikTok.
- Trend data is a bundled list from months ago.

## What we're building

A 4-stage engine that **invents** the format, **competes** the hook, **grounds** every claim in real dreyv evidence, and **learns** from your actual TikTok performance.

### Stage 1 — Direction Generator (replaces format dropdown)

Input: free-text intent (`"show how dreyv catches a bad trade"`) + optional audience.

Model: `google/gemini-3-flash-preview` via Lovable AI Gateway, structured output.

Output: **3 distinct creative directions**, each with:
- Format invented from scratch (not from the 8-format list) — name, why it fits TikTok 2026, target watch-through
- Angle / emotional core
- Duration recommendation (model-decided, not preset)
- Risk level + why it could flop
- One-line "if this works, here's the comment we'll see"

UI: 3 cards, user picks one. No more format dropdown.

### Stage 2 — Hook Foundry (NEW)

For the chosen direction, generate **10 hook variants** (first 1.5s + first spoken line + on-screen text), then a **critic pass** that scores each on:
- Scroll-stop strength (pattern interrupt, curiosity gap, stakes)
- Concreteness (does it have a real number / wallet / name?)
- Watch-through prediction (will they wait for beat 2?)
- Originality vs current crypto/AI TikTok tropes

Surface all 10 with scores; auto-select the winner, let user override.

### Stage 3 — Evidence Grounding (NEW)

Before script generation, the planner pulls **real dreyv evidence** the video can cite:
- Live capability list from `src/lib/capabilities/handlers.ts`
- Real screenshots from `/app/analytics`, `/atlas`, `/case` (existing route assets)
- Real public case data from `/case/[address]` (already shipped)
- Founder's own wallet activity (opt-in, paste address)

Any factual claim in the script ("dreyv flagged a $12k drift") MUST reference one of these evidence items or the critic rejects it. Kills the generic "AI treasury" tropes.

### Stage 4 — Performance Loop (TikTok connector)

Wire up the existing **TikTok connector** (already available via `standard_connectors`):

- New edge function `tiktok-performance` pulls last 20 videos: views, likes, comments, shares, average_watch_time, full_video_watched_rate.
- Cached in `studio_video_performance` table (new migration).
- Direction Generator + Hook Foundry receive a compact "what's working / what's flopping" digest as system context — e.g. "Your top video used a wallet-address hook; your bottom 3 opened with mascot exposition. Avoid mascot-first openers."

User opt-in flow: button on studio "Connect TikTok for smart suggestions" → standard_connectors flow.

## Files

**New:**
- `src/app/api/studio/video/directions/route.ts` — Stage 1
- `src/app/api/studio/video/hooks/route.ts` — Stage 2
- `src/app/api/studio/video/evidence/route.ts` — Stage 3 evidence index
- `src/app/api/studio/video/tiktok-performance/route.ts` — Stage 4 sync
- `src/lib/media-studio/direction-generator.ts`
- `src/lib/media-studio/hook-foundry.ts`
- `src/lib/media-studio/evidence-index.ts`
- `src/lib/media-studio/tiktok-insights.ts`
- `db-migrations/0057_studio_video_performance.sql`
- `src/app/studio/video/DirectionPicker.tsx`
- `src/app/studio/video/HookFoundry.tsx`
- `src/app/studio/video/TikTokInsightsBanner.tsx`

**Modified:**
- `src/app/studio/video/VideoStudioShell.tsx` — replace format dropdown with intent input → directions → hooks → pack flow
- `src/app/api/studio/video/route.ts` — accept chosen direction + chosen hook + evidence refs instead of formatId
- `src/lib/media-studio/ai.ts` — pass evidence + tiktok digest into pack prompt; enforce evidence-citation rule

**Deprecated (kept for back-compat, not used in new flow):**
- `VIDEO_FORMATS`, `VIDEO_ANGLES` arrays in `video-tools.ts` — moved to "starter inspiration" the model *may* consider, not constraints.

## TikTok connector setup

I'll use the standard `tiktok` connector. User flow:
1. Studio shows "Connect TikTok" banner.
2. Clicking calls `standard_connectors--connect` for `tiktok`.
3. After connection, `tiktok-performance` route pulls `/v2/video/list/` with full metrics fields.
4. Performance digest is regenerated nightly via existing Inngest cron.

## What this means for the user

- Type `"show what happens when an agent burns USDC"` → see 3 invented formats → pick one → see 10 hooks ranked by a critic → pick one → get a pack that cites real screenshots and references your top-performing past hook style.
- No more "Today Years Old" template when the topic doesn't fit one.
- After a week of posting, the studio knows your audience and writes for *them*, not for generic TikTok.

## Out of scope (intentional)

- Not rebuilding the rendering pipeline (ffmpeg/Veo) — that already works.
- Not changing the style bible visual constraints — those keep mascot consistency, which is still right.
- Not auto-posting to TikTok — read-only analytics for now.

## Technical notes

- All model calls go through `lovable-ai-proxy` edge function (per project rule — Lovable AI is never called from Vercel directly).
- Structured outputs use Zod schemas kept small to avoid Gemini's "too many states" limit.
- Critic pass uses `gemini-3.5-flash` (faster, cheaper) since it scores rather than creates.
- TikTok analytics route guarded by `requireTeamMember` like other studio routes.
- New migration includes GRANTs per project rules.
