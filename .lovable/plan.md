
# Reddit Growth Engine for Dreyv MCP/API

Concept: don't market `dreyv.com` the app. Market the **developer surface** (MCP + API + 300+ capabilities) as something any Reddit user can plug into Claude/Cursor/ChatGPT in 30 seconds and feel magic — read-only by default, non-custodial when signing, agent-native payments as a bonus wow.

Build in three phases. Phase 1 is research-heavy and grounds everything else.

---

## Phase 1 — Deep Reddit Research (15 layers)

Run a structured research sweep (Perplexity `sonar-deep-research` + Firecrawl + Tavily, persisted to `knowledge_entries` with tag `reddit_playbook`). Each layer is a separate query/scrape so we can cite and reuse:

1. Subreddit map for our ICP (r/LocalLLaMA, r/ClaudeAI, r/cursor, r/mcp, r/AI_Agents, r/solana, r/defi, r/ethdev, r/CryptoCurrency, r/web3, r/SideProject, r/SaaS, r/programming, r/OpenAI, r/singularity) — size, posting rules, flair, karma/age gates, self-promo policy.
2. Top 100 posts of all time per sub — title patterns, length, time-of-day, weekday.
3. Top 100 posts last 90d per sub — what's working *now* vs evergreen.
4. Genuine vs fake/astroturf signals — comment ratio, account age, post history diversity, link-in-first-comment patterns, mod-removed examples.
5. "Show HN-style" launch posts that hit on Reddit — structure, screenshots, demo gif vs video, "I built X because Y" framing.
6. Developer-tool launch case studies (Cursor, Continue, Aider, Cline, Claude Code, OpenRouter, Smithery) — what their breakout Reddit posts looked like.
7. MCP-specific posts that went viral — "I gave Claude X and it did Y" pattern analysis.
8. Crypto/Web3 posts that survived anti-shill filters — non-pitchy, utility-first, no token, no price talk.
9. Title formulas that consistently beat baseline (question, contrarian, number, "I", "stop doing X").
10. Body structure: hook → context → demo → ask. Length sweet spot per sub.
11. Comment seeding patterns — OP first comment with link, follow-up Q&A cadence, how to handle skeptics.
12. Timing — best posting windows per sub in user's timezone (Africa/Accra → translate to sub's peak US/EU traffic).
13. Visual assets that lift CTR — terminal gif, before/after, mascot vs screenshot.
14. Risk patterns — what gets shadowbanned, what triggers AutoModerator, account warm-up requirements.
15. Compliance/legal — Reddit content policy, self-promo 9:1 rule, subreddit-specific bans on AI-generated content.

Deliverable: `docs/marketing/reddit-playbook.md` synthesizing all 15 layers into rules + templates. Also persisted to knowledge memory so the draft generator can RAG it at runtime.

---

## Phase 2 — Positioning the MCP/API (the "wow" angles)

Pull from `src/lib/agents/capabilities/registry.ts` (300+ caps across treasury, trading, yield, intel, studio, payments, risk, signing, watchers, onramp). Mine for hooks that:

- Sound impossible until you see it run in Claude.
- Need zero wallet connection (read-only) — kills the safety objection.
- Combine 2-3 caps into a single magic moment.

Candidate hero hooks (research will narrow to top 5):

- "Paste any Solana wallet → Claude tells you the story" (intel + portfolio + pnl + risk).
- "Ask Claude 'is this token a rug?' — actual on-chain forensics, not vibes" (security_firewall + risk_assessment).
- "Claude finds the best yield for your stables across 40+ protocols, ranked by risk" (yield + risk).
- "Your agent has a USDC wallet now. It pays per call. You never touch it." (agent payments / x402 / prepaid balance).
- "Foresight: 'simulate selling 30% of my SOL at $X' — Claude runs the impact model" (foresight_simulation).
- "Compare any two wallets head-to-head in one prompt" (case studies).

Each hook → one Reddit post draft + one X thread + one short demo gif spec. Safety copy block reused everywhere: *read-only by default, no wallet connection, non-custodial signing when needed, free tier covers testing*.

Free-tier guard check: confirm `src/app/api/v1/[...slug]/route.ts` per-call billing + rate limits on Free tier actually cap exposure before we drive Reddit traffic. If not, tighten before launch.

---

## Phase 3 — Studio Reddit Draft Generator

New section in `/studio` (password-gated, alongside Media Studio + Case Studies).

UI (`src/app/studio/reddit/`):
- Sub picker (typeahead from research-curated list, shows rules + self-promo policy + AI-content stance inline).
- Angle picker (top 5 hooks from Phase 2, or "custom").
- Tone slider: founder-casual ↔ technical-deep ↔ contrarian-take.
- Length: short (<150w) / medium (250-400w) / long (500w+).
- Asset slot: optional gif/screenshot upload (reuse media-studio R2).
- Generate → streams title + body + first-comment + 3 backup titles + posting-time recommendation + rule-compliance checklist (account age, karma, flair, link policy).
- Edit-in-place, then "Copy to Reddit" (no auto-post — human-in-the-loop per brand voice rules).

Backend (`/api/studio/reddit/draft`):
- Calls Lovable AI via Supabase edge function (per project rule — never direct from Vercel).
- System prompt loads `reddit_playbook` entries from `knowledge_entries` (RAG) + the picked sub's specific rules + Dreyv brand voice constants (no emoji-spam, no hashtags, banned words list).
- Forces safety block, free-tier mention, MCP/API URLs (`/developers/mcp`, `/auth.md`), never `dreyv.com` as the pitch surface.
- Returns structured JSON: `{ titles[], body, firstComment, postingWindow, complianceChecks[] }`.

Persistence: `reddit_drafts` table (id, user_id, subreddit, angle, title, body, first_comment, status [draft/posted], posted_at, created_at) with RLS + GRANTs per project rules. No auto-posting; "posted" is manually marked after the human submits on reddit.com.

---

## Technical details (skip if non-technical)

- Research persistence reuses `knowledgeMemory.store` with `source: "reddit_research"` and `tags: ["reddit_playbook", <subreddit>]` — already wired in `src/lib/knowledge.ts`.
- Edge function: `supabase/functions/reddit-draft/index.ts` using existing `_shared/ai-gateway.ts` helper, model `google/gemini-3-flash-preview` (default per project rules).
- DB migration `db-migrations/0052_reddit_drafts.sql` with the standard public-schema GRANT block + RLS scoped to `auth.uid()`.
- Studio shell pattern mirrors `src/app/studio/case-studies/CaseStudiesShell.tsx` (password gate → client component).
- Free-tier guard verified in `src/app/api/v1/[...slug]/route.ts` (already charges per call, returns 402 on insufficient balance) — confirm Free tier daily cap exists; add one if not.

---

## What I need from you before I start

Pick the scope for this turn:

**A. Full pass** — run all 15 research layers now (Perplexity deep research, ~10-15 min of API time, costs credits), write the playbook, ship Phase 2 hooks doc, then build Phase 3 generator end-to-end.

**B. Research-only first** — run the 15 layers, ship `docs/marketing/reddit-playbook.md` + the positioning hooks doc. Review together. I build the studio generator in the next turn once you approve angles.

**C. Build-first, research-light** — quick 3-layer research, ship the generator wired to a basic playbook now, deepen research after we see real drafts.

I recommend **B**: the whole point you made was "no surface research." Doing the playbook properly first means the generator's output is grounded the moment it ships, instead of being rewritten after the fact.
