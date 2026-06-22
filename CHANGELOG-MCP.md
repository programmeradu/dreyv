# Dreyv MCP + Public API — Changelog

Single source of truth lives in [`src/lib/mcp/changelog.ts`](src/lib/mcp/changelog.ts).
That module also feeds the `dreyv_meta_version` MCP tool and the
`/api/mcp/manifest` endpoint, so agents and dashboards always see the same
history this file shows humans.

## How clients pick up updates

- **Claude Desktop / Cursor / Continue** re-call `tools/list` on every new
  chat session (and on app restart). Additive changes — new tools, expanded
  enums, new optional input fields, new response keys — propagate
  automatically. No JSON config edit, no key rotation.
- **A mid-conversation refresh** requires starting a fresh chat (Claude) or
  toggling the server entry off/on (Cursor → Settings → MCP).
- **The REST surface at `/api/v1`** is stateless; agents see the new
  behavior on the very next call.
- **Breaking changes** bump the major version and are called out in the
  matching entry's `notes` field. We aim never to ship one without prior
  deprecation through `dreyv_meta_version`.

## Versioning

Semver, where the surface area is the MCP tool registry + REST shape:

- **MAJOR** — a tool is removed or its input/output shape changes
  incompatibly. Migration notes ship in the entry.
- **MINOR** — new tools, new optional inputs, new response keys, new
  pillars/scopes. Fully backwards-compatible.
- **PATCH** — bug fix, doc/instruction wording, internal-only changes.

---

## 1.3.1 — 2026-06-22 (patch)

**Fix: mobile signer "Handoff not found or expired" on Vercel.**
Handoffs were stored in a process-local `Map`, so the MCP tool call that
staged the unsigned tx and the `/mobile/signer` GET that read it almost
always landed on different serverless instances → 404.

### Fixed
- Persist `mcp_handoffs` in Neon Postgres (auto-created on first use; falls back to in-memory only when `DATABASE_URL` is unset).
- `/mobile/signer?id=…`, `/api/mcp/handoff/[id]`, and the Solana-Pay `/sign` endpoint now resolve across cold starts and across regions.

---

## 1.3.0 — 2026-06-22 (minor)

**One-shot swap tool + uniform deeplinks on every `UNSIGNED-TX` response.**
Removes the multi-call `quote → tx → handoff` dance that was tripping up
agents (and burning an hour on what should be a 30-second call).

### Added
- `dreyv_defi_swap` — **single** call that bundles
  `dreyv_defi_swap_quote` + `dreyv_defi_swap_tx` + `dreyv_intents_deeplinks`.
  Inputs: `{ inputMint, outputMint, amount, userPublicKey, slippageBps? }`.
  Returns `{ quote, swapTransaction, dreyvPreflight, dreyvDeeplinks: { qrSvgDataUri, mobileHandoffUrl, phantomUniversal, solflareUniversal, backpackUniversal, handoffId } }`.
  The agent renders the QR or opens the deeplink — no second tool call, no
  passing around the (large, nested) Jupiter `quoteResponse` JSON.
- `dreyvDeeplinks` now attached to `dreyv_governance_vote_tx` too, so
  **every** `[UNSIGNED-TX]` tool ships a one-tap signing package uniformly.

### Changed
- MCP `initialize.instructions` now leads with: **ASK THE USER for their
  Solana wallet address** before any `UNSIGNED-TX` call, and reuse it for
  the rest of the session. Stops the "which wallet?" guessing loop.
- `dreyv_meta_intents_howto` Solana swap playbook now features the one-shot
  flow as the default; the two-step `quote → tx` flow is documented as a
  fallback for custom routing.

### Notes
Fully additive — no breaking changes. `dreyv_defi_swap_quote` and
`dreyv_defi_swap_tx` remain available for custom flows. Clients pick up the
new tool on the next `tools/list` call.

---

## 1.2.0 — 2026-06-22 (minor)

**Non-custodial execution UX — one-tap mobile signing + opt-in autonomous session signer.**

### Added
- `dreyv_intents_deeplinks` — wrap any base64 transaction in Phantom /
  Solflare / Backpack universal sign links.
- `dreyv_intents_handoff_qr` — stage a transaction, get back a QR plus a
  `/mobile/signer` URL for desktop → phone handoff.
- `dreyv_session_signer_create` / `_sign` / `_status` / `_revoke` — capped
  ephemeral Ed25519 keypair. Server enforces `maxLamports`, `maxTxCount`,
  `allowedProgramIds`, and TTL. The user's primary wallet keys never touch
  the server.
- Every `UNSIGNED-TX` response (`dreyv_defi_swap_tx`,
  `dreyv_defi_stake_sol_tx`) now ships a `dreyvDeeplinks` block by default.

### Changed
- MCP `initialize.instructions` rewritten to document the ONE-TAP SIGNING
  and AUTONOMOUS SIGNING flows.
- `dreyv_meta_intents_howto` playbooks extended with the session-signer and
  QR handoff sequences.

### Notes
Fully additive — no breaking changes. Clients pick up the new tools on the
next `tools/list` call (a new chat session in Claude, or a Cursor reload).

---

## 1.1.0 — 2026-06-15 (minor)

**Public typed capability registry — 300+ tools across 39 pillars on Streamable HTTP.**

### Added
- MCP server at `/api/mcp` with Bearer-key auth and scope enforcement.
- Meta discovery tools: `dreyv_meta_version`, `_capabilities_overview`,
  `_intents_howto`, `_instructions`.
- Mirrored REST surface at `/api/v1/<capability>` with the same scope model.
