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
