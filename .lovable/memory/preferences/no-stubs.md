---
name: no-stubs
description: NEVER ship stubs, fake/random IDs, ARMED-only states, or DEFERRED placeholders in any agent capability or executor — every capability must call a real API/SDK/RPC.
type: preference
---

**Rule:** Every capability in `src/lib/agents/capabilities/*` and every executor in DACS must do **real work** against a **real protocol/API/data source**.

**Forbidden patterns:**
- `streamId: \`stream_\${Math.random()…}\`` (or any `Math.random()` ID returned as if it were a real on-chain ID)
- `status: "ARMED"` / `status: "DEFERRED_TO_INDEXER"` / `status: "NEEDS_PARSE"` as a *terminal* state with no follow-up worker
- `compositeRisk: "UNKNOWN"` or any "we'll fill this in later" payload
- Hardcoded allocation numbers presented as real recommendations (must come from live oracle/API)
- "Connect wallet to build transaction" returned when wallet IS connected

**Required for every capability:**
1. Real RPC/API/SDK call — no fake IDs in critical fields
2. Real artifact — signable tx, downloadable URL, or live data
3. Logged to `agent_episodes` with input + output + post-mortem
4. Inngest reconciliation loop verifies on-chain state within 60s

**Why:** The user explicitly said "everything must work" and "never create stubs or fake implementations that only pretend to work." Dreyv is positioned as a non-custodial agentic treasury — a pretend execution is a trust-killer.

**How to apply:** Before marking any capability ✅ in `.lovable/dacs-phase7-capability-audit.md`, all 4 acceptance criteria must pass. If a real integration is missing, add it to the integration table in that file and wire it — never paper over it. If something *truly* requires a deferred indexer pass, the capability must return a real `jobId` from a real queue (Inngest event id) AND the result must stream back via SSE/episode update — not a fake placeholder string.
