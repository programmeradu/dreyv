# Living Canvas Dashboard

Your answers locked the scope: **stacked stream + draggable**, **per-user persistence**, **all 48 capabilities exposed**, **legacy widgets deleted**.

## 0. Fix `dist-check` (blocker)

The previous turn hand-edited `packages/sdk/dist/*` to strip Turnkey instead of rebuilding. Hand-edited bundler output is brittle and is what `dist-check` is flagging.

- Run `cd packages/sdk && npx tsup src/index.ts --format cjs,esm --dts --clean` to regenerate clean artifacts from source.
- Update `packages/sdk/package.json` description ("21 hooks" → "20 hooks") so it matches the actual export count post-Turnkey removal.

(I verified the rebuild succeeds and produces consistent CJS/ESM/dts.)

## 1. Canvas state layer

New `src/lib/canvas/` module:

- **`types.ts`** — `CanvasBlock` discriminated union: `narrative | metric | chart | plan | watcher | decision | capability-result | suggestion`. Every block carries `{ id, type, source: 'commandbar'|'agent'|'user'|'page', createdAt, pinned, payload }`.
- **`CanvasContext.tsx`** — React context exposing `{ blocks, pinned, addBlock, removeBlock, pinBlock, reorderBlocks, clearEphemeral }`. Mounted once in `src/app/app/layout.tsx` so every page in `/app/*` shares one canvas.
- **`persistence.ts`** — debounced writer to `localStorage` keyed by `canvas:v1:${userId ?? 'anon'}` (userId from `useKeystoneAuth().siwsUser?.id`). Loads on mount, persists `pinned` blocks only; ephemeral blocks die on reload. Per-user, as requested.
- **`useCanvas()`** hook — primary consumer API.

## 2. Bus → Canvas bridge

`AppEventBus` is currently a write-only notify channel. We add a single subscription point:

- `src/lib/canvas/bus-bridge.tsx` — mounted inside the `CanvasProvider`. Subscribes to `useAppEvent` and translates a small set of event types into `addBlock` calls:
  - `CANVAS_ADD_BLOCK` (explicit)
  - `AGENT_LOG` → narrative block (collapsed timeline)
  - `SHOW_STRATEGY_MODAL` → plan block (rendered inline instead of modal)
  - `UI_NOTIFICATION` → suggestion block

This means existing emitters (`DreyvAgentInput`, `AgentCommandCenter`, CommandBar handlers, `/api/command` responses) **automatically** start populating the canvas with no changes to their call sites.

## 3. Dashboard rebuild — `/app` page

Replace `src/app/app/page.tsx` body with:

- **Header** (kept): brand, links, wallet button.
- **Hero strip**: `HeadlineValue` (treasury) + `TrendCurve` — pinned, always first.
- **The Canvas**: vertical stacked stream of `CanvasBlock` renderers.
  - Wrapped in `framer-motion` `Reorder.Group` so blocks are draggable to reorder (covers the "draggable" half of answer 1).
  - Each block: provenance chip (`from CommandBar` / `from Dreyv` / `pinned`), pin/unpin, dismiss, timestamp.
  - Empty state: ambient "Ask Dreyv anything…" prompt + 3 starter chips.
- **Bottom**: existing CommandBar (now a conductor — see §5).

New components in `src/components/canvas/`:
- `CanvasStream.tsx` — Reorder container.
- `BlockShell.tsx` — common chrome (provenance, pin, dismiss).
- `blocks/NarrativeBlock.tsx`, `MetricBlock.tsx`, `PlanBlock.tsx`, `WatcherBlock.tsx`, `DecisionBlock.tsx`, `CapabilityResultBlock.tsx`, `SuggestionBlock.tsx`, `ChartBlock.tsx`.
- All use the `Surface` / `StreamIn` / `Pill` primitives from `app-shell/primitives.tsx` so the Stitch-light aesthetic is preserved.

## 4. Capability Palette (all 48)

New `⌘K` palette wired to `capabilityRegistry()`:

- `src/components/canvas/CapabilityPalette.tsx` — uses existing `cmdk`-based `command.tsx` primitives.
- Reads `listCapabilities()` (registry already exposes domain, sensitivity, description).
- Groups by domain (treasury / trading / yield / intel / studio / dynamic / misc / policy / payments / risk).
- Selecting a capability either:
  - opens a parameter sheet (zod schema → form), then dispatches via the existing `/api/command` pipeline, **or**
  - for read-only `sideEffects: "read"`, executes immediately and adds a `CapabilityResultBlock` to the canvas.
- Sensitivity badge (low/medium/high) + auth requirement chip shown inline.

## 5. CommandBar as conductor (not just router)

Today `CommandBar` mostly emits `NAVIGATE`. We extend its result handler:

- Update the existing `/api/command` consumer (and `landing-command-bar.tsx`'s sibling in `/app/*`) so that on plan response it calls `addBlock({ type: 'plan', source: 'commandbar', payload })` **in addition to** the current modal flow. We then make the modal optional — if a plan lands on the canvas, no modal pops; user reviews inline.
- For "show me…" intents (price check, portfolio, market overview, holder insights), bypass navigation and add the corresponding result block directly to the canvas.
- Keep `NAVIGATE` for hard route changes (`/app/studio`, `/atlas`, etc.).

Cross-page interaction: because the `CanvasProvider` lives at `/app/layout.tsx`, blocks added from `/app/treasury` or `/app/analytics` show up on `/app` too. The provenance chip records the originating page so the user can trace it.

## 6. Demolition (per answer 4)

Delete after porting their data hooks into blocks:
- `src/components/dashboard/AgentCommandCenter.tsx` → its bus listener logic moves into `bus-bridge.tsx`; visual log replaced by `NarrativeBlock`s.
- `src/components/dashboard/DreyvAgentInput.tsx` → superseded by the conductor CommandBar at the bottom of the canvas.
- The static CSS-grid `/dashboard` page (TreasuryChart, YieldOptimizer, RiskRadar, vault/payroll/directive widgets) — port `TreasuryChart` data into `ChartBlock`, `YieldOptimizer` into a pinnable `WatcherBlock`, `RiskRadar` into a `MetricBlock`. Then delete the page.
- Confirm no other route imports them (rg sweep) before delete.

## 7. Files to touch / create

**Create**
- `src/lib/canvas/types.ts`
- `src/lib/canvas/CanvasContext.tsx`
- `src/lib/canvas/persistence.ts`
- `src/lib/canvas/bus-bridge.tsx`
- `src/lib/canvas/useCanvas.ts`
- `src/components/canvas/CanvasStream.tsx`
- `src/components/canvas/BlockShell.tsx`
- `src/components/canvas/CapabilityPalette.tsx`
- `src/components/canvas/blocks/*.tsx` (8 block types)

**Edit**
- `src/app/app/layout.tsx` — wrap with `CanvasProvider` + mount `BusBridge` + register `⌘K` for `CapabilityPalette`.
- `src/app/app/page.tsx` — replace body with `CanvasStream`.
- `src/components/CommandBar.tsx` (and/or `landing-command-bar.tsx` analog) — add `addBlock` calls to result handler.
- `packages/sdk/package.json` — fix description, then rebuild dist.

**Delete**
- `src/components/dashboard/AgentCommandCenter.tsx`
- `src/components/dashboard/DreyvAgentInput.tsx`
- `src/app/dashboard/page.tsx` (and any unique widgets after porting).

## 8. Out of scope (call out explicitly)

- Liveblocks-shared canvas across multisig members — left for later (you chose per-user). The persistence layer is keyed so swapping `localStorage` → Liveblocks storage is one file later.
- MCP server exposing the registry — still parked.
- Capability auto-execution policy / risk veto integration — palette dispatches via existing pipelines, no new policy layer this pass.

Once approved I'll execute §0 first (unblocks build), then §1→§7 in order.
