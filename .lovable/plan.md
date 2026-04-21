

# Studio Chat — Conversational Build Experience

Transform the chat from a silent "Done, 1 file changed" into a Lovable/Cursor-style conversational stream showing thinking, reasoning, file activity, and post-build summaries.

---

## What's wrong today

- After submitting a prompt, the chat shows only a final terminal-style "Done — 1 file added" line.
- No streaming reasoning, no per-file activity, no plan recap, no summary of what changed and why.
- Streamed tokens from the LLM go into a hidden buffer; the user only sees the parsed `explanation` at the end (often a single short sentence).
- No tool/activity cards (file added, file modified, fixing errors, attempt 2/3).
- No follow-up — once a build finishes, there's no "what next?" affordance.

---

## What we'll build

### 1. Conversational assistant messages (streaming)

In `architect-engine.ts` and `/api/studio/generate-stream`, parse the streamed LLM output into **two channels**:
- **`thinking` / `reasoning` text** — everything before the JSON code block, streamed token-by-token into a collapsible "Thinking…" bubble (Cursor-style).
- **`explanation` text** — the final natural-language summary, streamed into the main assistant bubble after files are parsed.

Update `STUDIO_SYSTEM_PROMPT` to require the model to:
1. Open with a short reasoning paragraph (what it understood, the approach).
2. Emit the JSON `{ files, explanation }` block.
3. Close with a markdown summary listing each file changed and why.

### 2. Activity cards in the chat thread

New component `ArchitectActivityCard.tsx` rendered inline between assistant messages. Card variants:
- **Plan** — clarify Q&A + chosen integrations (replaces the overlay PlanStepper).
- **File added** — green dot, file name, line count, "View" button to open in Code tab.
- **File modified** — blue dot, file name, +N/-N diff stats, "View diff" button.
- **Analyzing** — spinner with detected issues count.
- **Fixing** — "Attempt 2/3 — fixing useFetch import" with progress.
- **Done** — final card: total files, bytes, elapsed time, model used, token cost.
- **Error** — red card with retry button.

Wire `ArchitectEngine` to emit `onActivity(event)` for each transition; `PromptChat` renders the event log inline.

### 3. Post-build summary message

After `done`, the assistant posts a structured markdown message:
```
Built your Jupiter swap widget.

What I changed:
- App.tsx (new) — main UI with token selector, amount input, swap button
- lib/jupiter.ts (new) — quote + swap helpers using useFetch
- styles.css (modified) — added gradient bg

Why: you asked for a clean Jupiter swap UI, so I used the v6 quote API
through the sandbox fetch proxy and added a Phantom-style layout.

Try it: click "Get Quote" in the preview, then "Swap".
```

Plus follow-up suggestion chips: "Add slippage settings", "Add wallet connect", "Add transaction history".

### 4. Thinking indicator + live status

Replace the bottom status pill with a **chat-integrated status row**:
- "Architect is thinking…" with animated dots while STREAMING.
- "Analyzing 3 files…" while ANALYZING.
- "Fixing 2 issues (attempt 2/3)…" while CORRECTING.
- Auto-hide on CLEAN.

### 5. Persistent conversation memory

Currently each prompt is treated standalone. We'll:
- Pass full message history (last 10 turns) as context to `/api/studio/generate-stream`.
- Add a "memory" prefix in the prompt: "Previous changes in this session: …".
- This lets follow-ups like "make the button bigger" or "now add slippage" work naturally.

### 6. Fix build error first

Before any of the above, fix the blocker reported in your build output:
- `src/components/providers/web3-provider.tsx` line 5: change `from "wagmi/chains"` → `from "viem/chains"`.

---

## Technical changes

| File | Change |
|---|---|
| `src/components/providers/web3-provider.tsx` | Switch chains import to `viem/chains` |
| `src/lib/studio/system-prompt.ts` | Add reasoning + summary structure requirements |
| `src/lib/studio/architect-engine.ts` | Add `onActivity` callback, emit per-event cards, split thinking vs explanation streams |
| `src/app/api/studio/generate-stream/route.ts` | Stream thinking text as `{type:"thinking",content}` SSE events; pass message history |
| `src/components/studio/ArchitectActivityCard.tsx` | **New** — card variants (plan, file_added, file_modified, analyzing, fixing, done, error) |
| `src/components/studio/PromptChat.tsx` | Render activity cards inline, thinking bubbles (collapsible), follow-up chip suggestions, persistent message history |
| `src/components/studio/PlanStepper.tsx` | Convert overlay to inline assistant-message card |

---

## Acceptance

- Submit a prompt → see "Architect is thinking…" → reasoning streams into a collapsible bubble → activity cards appear (Plan → File added: App.tsx → Analyzing → Done) → final assistant message summarizes what was built and why → follow-up chips appear.
- Follow-up prompt ("make it dark mode") references the previous build correctly.
- Build compiles (wagmi/viem fix).

Approve to start with the build fix + Phase 1 (reasoning stream + activity cards + summary), then Phase 2 (memory + follow-up chips + inline PlanStepper).

