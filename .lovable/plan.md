

# Studio Empty-State Flow + Self-Learning Architect

Build a Lovable/Bolt-style empty state that **only ships real apps** — no mocks, no stubs. Three-stage AI-guided flow that clarifies intent, picks real integrations, previews a build plan, then hands off to ArchitectEngine with anti-mock guardrails and Firecrawl+Perplexity research enrichment for unknown protocols.

## What gets built

### 1. Empty-state UI at `/app/studio` (when no project loaded)
Full-screen prompt box, dreyv violet, replaces the current "drop into App.tsx" behavior.

```text
┌───────────────────────────────────────────────────────┐
│                                                       │
│        What do you want to build?                     │
│   ┌─────────────────────────────────────────────┐     │
│   │ A staking dashboard for mSOL holders…       │     │
│   └─────────────────────────────────────────────┘     │
│              [ Generate plan → ]                      │
│                                                       │
│   Examples: staking dashboard · token-gated chat ·    │
│   DCA bot UI · Squads multisig viewer                 │
│                                                       │
│   ─── or ──                                           │
│   [Start from template]  [Open recent]                │
└───────────────────────────────────────────────────────┘
```

After submit, transitions to a **3-stage stepper** in the same panel:

- **Stage 1 — Clarify**: AI returns 2–4 targeted questions (network, wallets, read-only vs transactional, target protocol). Rendered as chips/radio groups, no free-text where avoidable.
- **Stage 2 — Integrations**: AI proposes a real stack. Each integration shown as a toggle with status badge:
  - `✓ ready` (key in env / connector linked)
  - `⚙ needs setup` (opens connector flow / secret prompt)
  - `🔬 researching` (unknown protocol → Firecrawl+Perplexity kicks in)
- **Stage 3 — Plan preview**: file tree, data sources list, on-chain calls, "real vs needs-your-input" checklist, **[Build it →]** button. On click, hands the enriched context to existing `ArchitectEngine.generate()`.

### 2. New API routes (Next.js App Router, not Supabase functions — matches existing project)

- **`/api/studio/clarify`** — POST `{ prompt }` → `{ questions: [{id, text, options[], multi}] }`. Uses Lovable AI Gateway (`google/gemini-3-flash-preview`) with tool-calling for structured output.
- **`/api/studio/plan`** — POST `{ prompt, answers, knownIntegrations }` → `{ integrations: [{id, name, status, requiredSecrets[]}], files: [...], dataSources: [...], onChainCalls: [...], unknownProtocols: [...] }`. Triggers research enrichment for any `unknownProtocols`.
- **`/api/studio/research`** — POST `{ protocol, prompt }` → fetches docs via **Firecrawl** (scrape protocol docs URL) + **Perplexity** (`sonar-pro` for SDK shape and code examples), returns markdown chunk + extracted SDK signatures, persists to existing `knowledgeEntries` table with `source: "studio_research"`.

All three use existing `checkRouteLimit` middleware and `getAuthUserId` pattern from `src/app/api/runs/route.ts`.

### 3. Anti-mock guardrails in `ArchitectEngine.analyzeCode`

Extend the existing `forbiddenPatterns` array with:

```ts
[/\b(mock|stub|placeholder|dummy|fake|lorem|TODO|FIXME)\w*\s*[:=]/i, "No mocks/stubs allowed — use real data from useFetch()"],
[/\b0x0{20,}\b/, "Zero-address placeholder detected — use a real address"],
[/setTimeout\([^)]*(mock|fake|dummy)/i, "Fake-data setTimeout detected"],
[/const\s+\w+\s*=\s*\[\s*\{\s*(id|name)\s*:\s*['"`](test|sample|example|foo|bar)/i, "Hardcoded sample data — fetch real data instead"],
```

When triggered → engine enters CORRECTING state with prompt: "Replace mock data with a real `useFetch()` call to {suggested API from researchContext}."

### 4. Research enrichment wired into `ArchitectEngine.generate(...)`

Engine already accepts `researchContext` parameter. The **plan stage** assembles it from:
- `web3-context.ts` SDK_HOOK_DOCS for known hooks
- `studio_research` knowledge entries for unknown protocols
- Recent `studio_runs` outcomes for the same prompt category (re-rank suggestions)

### 5. New telemetry table `studio_runs` (migration)

```ts
export const studioRuns = pgTable('studio_runs', {
  id: serial('id').primaryKey(),
  shortId: text('short_id').notNull().unique(),
  userId: uuid('user_id').references(() => users.id),
  prompt: text('prompt').notNull(),
  promptCategory: text('prompt_category'),       // staking | swap | dao | nft | other (LLM-tagged)
  clarifyAnswers: jsonb('clarify_answers'),
  chosenIntegrations: jsonb('chosen_integrations'), // [{id, status}]
  unknownProtocols: jsonb('unknown_protocols'),     // [protocol names that triggered research]
  researchSources: jsonb('research_sources'),       // [{url, source: firecrawl|perplexity}]
  analyzerOutcome: text('analyzer_outcome'),        // CLEAN | CORRECTED | FAILED
  attempts: integer('attempts'),
  shipped: boolean('shipped').default(false),
  errors: jsonb('errors'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('studio_runs_user_idx').on(t.userId),
  categoryIdx: index('studio_runs_category_idx').on(t.promptCategory),
  outcomeIdx: index('studio_runs_outcome_idx').on(t.analyzerOutcome),
}));
```

Logged at three points: clarify start, plan finalized, build complete.

### 6. Self-learning loop

`/api/studio/plan` queries `studioRuns` for past successful runs in the same `promptCategory` and re-ranks integration suggestions by `success_rate * recency`. Cold start uses a static priority list.

## Files created / edited

**New:**
- `src/components/studio/EmptyState.tsx` — full-screen prompt box
- `src/components/studio/PlanStepper.tsx` — 3-stage stepper shell
- `src/components/studio/stages/ClarifyStage.tsx`
- `src/components/studio/stages/IntegrationsStage.tsx`
- `src/components/studio/stages/PlanPreviewStage.tsx`
- `src/app/api/studio/clarify/route.ts`
- `src/app/api/studio/plan/route.ts`
- `src/app/api/studio/research/route.ts`
- `src/lib/studio/integration-registry.ts` — maps integration ids → required secrets/connectors
- `src/lib/studio/prompt-categorizer.ts` — Lovable AI tool call to tag category
- DB migration: `studio_runs` table

**Edited:**
- `src/app/app/studio/page.tsx` — render `<EmptyState />` when `files === DEFAULT_FILES && !currentAppId`; on Build click, call `engine.generate(prompt, files, [], researchContext)`
- `src/lib/studio/architect-engine.ts` — extend `analyzeCode` with anti-mock patterns
- `src/db/schema.ts` — add `studioRuns` export

## Dependencies / secrets needed

- **Lovable AI Gateway** — already wired (`LOVABLE_API_KEY` auto-provisioned). Used for clarify/plan/categorize.
- **Firecrawl** — link via `standard_connectors--connect` (connector_id: `firecrawl`). Already used in `src/lib/firecrawl.ts`; will reuse.
- **Perplexity** — link via `standard_connectors--connect` (connector_id: `perplexity`). New.

## Out of scope (call out, don't build now)

- Real-time integration health checks (just check env presence for v1)
- UI for browsing past `studio_runs` (telemetry collected, dashboard later)
- Per-user OAuth for end-users of generated apps (uses developer's connectors)
- Replacing the existing Keystone green theme in the rest of Studio (separate rebrand task)

## Build order

1. Migration: `studio_runs` table + schema export
2. `integration-registry.ts` (static map)
3. `/api/studio/clarify` + `/api/studio/plan` + `/api/studio/research` routes
4. Connect Perplexity connector (Firecrawl already present)
5. Empty-state UI + 3-stage stepper components
6. Wire stepper → ArchitectEngine with researchContext
7. Anti-mock guardrails in `analyzeCode`
8. Telemetry hooks at clarify/plan/build points
9. Verify end-to-end with a "build a Marinade staking dashboard" prompt

