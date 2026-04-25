/**
 * DACS Phase 1 — feature flag + capability filters.
 *
 * `DACS_ENABLED` controls the cutover. Three modes:
 *   - "off"     (default): legacy route.ts handles every request, DACS dormant.
 *   - "shadow":  legacy still serves the user; DACS runs in parallel, writes
 *                its plan + decision to `command_diff_log` for diff review.
 *   - "primary": DACS serves the user; legacy is dormant.
 *
 * Phase 6 cutover deletes the legacy path once "primary" has been clean for
 * a week.
 */

export type DacsMode = "off" | "shadow" | "primary";

export function dacsMode(): DacsMode {
  const v = (process.env.DACS_ENABLED || "").toLowerCase().trim();
  if (v === "1" || v === "true" || v === "primary") return "primary";
  if (v === "shadow") return "shadow";
  return "off";
}

export function dacsActive(): boolean {
  const m = dacsMode();
  return m === "shadow" || m === "primary";
}
