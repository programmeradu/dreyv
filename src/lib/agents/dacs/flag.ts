/**
 * DACS Phase 1 — feature flag + capability filters.
 *
 * `DACS_ENABLED` controls the cutover. Three modes:
 *   - "off":     legacy route.ts handles every request, DACS dormant.
 *   - "shadow":  legacy still serves the user; DACS runs in parallel, writes
 *                its plan + decision to `command_diff_log` for diff review.
 *                **Default** — required so the admin parity audit page is
 *                populated as commands run.
 *   - "primary": DACS serves the user; legacy is dormant.
 *
 * Phase 6 cutover deletes the legacy path once "primary" has been clean for
 * a week.
 */

export type DacsMode = "off" | "shadow" | "primary";

export function dacsMode(): DacsMode {
  const v = (process.env.DACS_ENABLED || "").toLowerCase().trim();
  if (v === "1" || v === "true" || v === "primary") return "primary";
  if (v === "off" || v === "0" || v === "false") return "off";
  // Default to shadow so command_diff_log gets populated and the admin
  // parity audit has data to render.
  return "shadow";
}

export function dacsActive(): boolean {
  const m = dacsMode();
  return m === "shadow" || m === "primary";
}
