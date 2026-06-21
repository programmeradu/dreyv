---
name: No fallbacks in Dreyv API / MCP capabilities
description: Every capability in /api/v1/* and /api/mcp must return real upstream data or a real error. No silent fallbacks, no stub objects, no "warming up" placeholders, no fake empty arrays disguised as success.
type: constraint
---
Strict rule for the Dreyv public API + MCP server (`src/lib/capabilities/handlers.ts`, `src/app/api/v1/[...slug]/route.ts`, `src/app/api/mcp/route.ts`):

**Never** add fallback objects when an upstream route is missing or fails. Examples that are BANNED:
- `.catch(() => ({ items: [], note: "warming up" }))`
- `.catch(() => ({ proposals: [], note: "not indexed yet" }))`
- Returning `{ resolved: false }` instead of surfacing the real upstream error.
- Returning empty `candles: []` when OHLCV upstream is missing.
- Any "best-effort" `.catch(() => null)` that hides a real failure from the caller.

**Required behavior:**
- If an upstream route doesn't exist yet → DO NOT register the capability. Remove it from the registry until it has a real implementation. A missing capability is better than a lying one.
- If an upstream call fails at runtime → propagate as a real `CapabilityError` with the upstream status + message. Let the dispatcher return `{ error: "capability_failed", message, status }`.
- If a capability needs a feature we haven't built (e.g. trending, ERC-8004 lookup), the handler must call a real internal endpoint we own. If it doesn't exist, BUILD IT, don't fake it.

**Why:** Dreyv positions as the ultimate Web3 API/MCP. Fake successes destroy trust the moment a developer inspects the payload. Empty arrays with notes are worse than 404s because they look correct in dashboards.
