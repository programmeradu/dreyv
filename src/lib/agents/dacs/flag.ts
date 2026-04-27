/**
 * DACS Phase 6 — feature flag (post-cutover).
 *
 * `DACS_ENABLED` controls the runtime mode:
 *   - "off":     legacy `/api/command` route serves the user; DACS dormant.
 *                Kept as an emergency rollback only.
 *   - "primary": **Default.** DACS pipeline (intent → plan → route → execute
 *                → reconcile) is the source of truth. The legacy route still
 *                handles the user-facing stream but publishes to the bus and
 *                consults the same capability registry.
 *
 * The Phase 1 "shadow" mode and command_diff_log parity harness were removed
 * after a clean parity week; see `.lovable/memory/features/dacs.md`.
 */

export type DacsMode = "off" | "primary";

export function dacsMode(): DacsMode {
  const v = (process.env.DACS_ENABLED || "").toLowerCase().trim();
  if (v === "off" || v === "0" || v === "false") return "off";
  // Default after Phase 6 cutover.
  return "primary";
}

export function dacsActive(): boolean {
  return dacsMode() === "primary";
}
