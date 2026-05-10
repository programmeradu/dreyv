/**
 * Platform-wide feature flags.
 *
 * EVM_ENABLED — paused 2026-05. EVM (Base/Arbitrum/Polygon/BSC) read-only
 * watchers, wallet linking, holdings, and crypto checkout are all hidden and
 * server-side disabled. Code is preserved for a future re-enable; flip this
 * to `true` to restore the surface.
 */
export const EVM_ENABLED = false;
