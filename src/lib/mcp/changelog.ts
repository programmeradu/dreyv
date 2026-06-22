/**
 * Dreyv MCP + public API changelog.
 *
 * Single source of truth — surfaced via:
 *   • `dreyv_meta_version` MCP tool (so agents read it inline)
 *   • `/api/mcp/manifest` (so dashboards/aggregators see it)
 *   • `CHANGELOG-MCP.md` (human-readable mirror at repo root)
 *
 * Bump SERVER_VERSION (semver) on every shipped entry. Clients (Claude
 * Desktop, Cursor, Continue, etc.) re-call `tools/list` on every new chat
 * session, so additive changes propagate automatically — no config edit
 * required. Breaking changes MUST bump the major and call it out in `notes`.
 */

export const SERVER_VERSION = "1.4.0";
export const SCHEMA_VERSION = "2025-06-18";

export interface ChangelogEntry {
  version: string;
  date: string; // ISO date
  kind: "major" | "minor" | "patch";
  summary: string;
  added?: string[];
  changed?: string[];
  fixed?: string[];
  removed?: string[];
  notes?: string;
}

/**
 * Newest first. Keep entries terse and agent-readable — these flow straight
 * into LLM context via `dreyv_meta_version`.
 */
export const MCP_CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.3.1",
    date: "2026-06-22",
    kind: "patch",
    summary:
      "Fix: mobile signer 'Handoff not found or expired' on Vercel. Handoffs now persist in Neon Postgres so the MCP tool call and the /mobile/signer GET survive landing on different serverless instances.",
    fixed: [
      "Persist mcp_handoffs in Postgres (auto-created on first use) instead of a process-local Map.",
      "/mobile/signer?id=… and /api/mcp/handoff/[id] now resolve across Vercel cold starts.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-06-22",
    kind: "minor",
    summary:
      "One-shot swap tool + uniform deeplinks on every UNSIGNED-TX response. Removes the multi-call quote→tx→handoff dance that was tripping up agents.",
    added: [
      "dreyv_defi_swap — SINGLE call that bundles quote + unsigned tx + dreyvDeeplinks (QR, phantomUniversal, solflareUniversal, backpackUniversal, mobileHandoffUrl). Inputs: { inputMint, outputMint, amount, userPublicKey, slippageBps? }.",
      "`dreyvDeeplinks` now attached to dreyv_governance_vote_tx as well, so every [UNSIGNED-TX] tool ships a one-tap signing package uniformly.",
    ],
    changed: [
      "MCP `initialize.instructions` now leads with: ASK THE USER for their Solana wallet address before any UNSIGNED-TX call, and reuse it for the session. Stops the 'which wallet?' guessing loop.",
      "`dreyv_meta_intents_howto` Solana swap playbook now features the one-shot flow as the default; the two-step quote→tx flow is documented as a fallback for custom routing.",
    ],
    notes:
      "Fully additive — no breaking changes. dreyv_defi_swap_quote / dreyv_defi_swap_tx remain available for custom flows. Clients pick up new tools on next tools/list call.",
  },
  {
    version: "1.2.0",
    date: "2026-06-22",
    kind: "minor",
    summary:
      "Non-custodial execution UX — one-tap mobile signing + opt-in autonomous session signer.",
    added: [
      "dreyv_intents_deeplinks — wrap ANY base64 tx in Phantom/Solflare/Backpack universal sign links.",
      "dreyv_intents_handoff_qr — stage a tx, get a QR + /mobile/signer URL for desktop→phone handoff.",
      "dreyv_session_signer_create / _sign / _status / _revoke — capped ephemeral Ed25519 keypair " +
        "with maxLamports / maxTxCount / allowedProgramIds / TTL caps enforced server-side. " +
        "Primary wallet keys never touch the server.",
      "Every UNSIGNED-TX response (dreyv_defi_swap_tx, dreyv_defi_stake_sol_tx) now ships a " +
        "`dreyvDeeplinks` block out of the box.",
    ],
    changed: [
      "MCP `initialize.instructions` rewritten to document the ONE-TAP SIGNING and AUTONOMOUS SIGNING flows.",
      "`dreyv_meta_intents_howto` playbooks extended with the session-signer + QR handoff sequences.",
    ],
    notes:
      "Fully additive — no breaking changes. Clients pick up new tools on next `tools/list` call (new chat session in Claude / Cursor reload).",
  },
  {
    version: "1.1.0",
    date: "2026-06-15",
    kind: "minor",
    summary: "Public typed capability registry, 300+ tools across 39 pillars on Streamable HTTP.",
    added: [
      "MCP server at /api/mcp with Bearer-key auth + scope enforcement.",
      "Meta discovery tools: dreyv_meta_version / _capabilities_overview / _intents_howto / _instructions.",
      "Mirrored REST surface at /api/v1/<capability> with identical scope model.",
    ],
  },
];

/** Convenience getter used by `dreyv_meta_version`. */
export function recentChangelog(limit = 5): ChangelogEntry[] {
  return MCP_CHANGELOG.slice(0, limit);
}
