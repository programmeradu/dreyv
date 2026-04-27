/**
 * DACS Phase 0 — Capability registry.
 *
 * Single source of truth for every capability in the system. Domain modules
 * (treasury.ts, trading.ts, etc.) export arrays of `Capability` objects;
 * `registerAll()` flattens them into a queryable map.
 *
 * Phase 1 planner reads from here. Phase 2 sandbox composer reads from here.
 * Phase 3 risk-agent reads sensitivity/protocols from here. Phase 6 cutover
 * makes this the only place capabilities live.
 *
 * The registry is built lazily on first access so per-domain module imports
 * don't fight Next.js's tree-shaking.
 */

import type { AnyCapability, CapabilityDomain } from "./types";
import { treasuryCapabilities } from "./treasury";
import { tradingCapabilities } from "./trading";
import { yieldCapabilities } from "./yield";
import { intelCapabilities } from "./intel";
import { studioCapabilities } from "./studio";
import { dynamicCapabilities } from "./dynamic";
import { miscCapabilities } from "./misc";
import { policyCapabilities } from "./policy";
import { paymentsCapabilities } from "./payments";
import { riskCapabilities } from "./risk";
import { deliverableCapabilities } from "./deliverables";
import { researchBriefCapabilities } from "./research-brief";

let cached: Map<string, AnyCapability> | null = null;

function buildRegistry(): Map<string, AnyCapability> {
  const all: AnyCapability[] = [
    ...treasuryCapabilities,
    ...tradingCapabilities,
    ...yieldCapabilities,
    ...intelCapabilities,
    ...studioCapabilities,
    ...dynamicCapabilities,
    ...miscCapabilities,
    ...policyCapabilities,
    ...paymentsCapabilities,
    ...riskCapabilities,
    ...deliverableCapabilities,
    ...researchBriefCapabilities,
  ];
  const map = new Map<string, AnyCapability>();
  for (const cap of all) {
    if (map.has(cap.id)) {
      throw new Error(
        `[capabilityRegistry] Duplicate capability id: "${cap.id}". Each id must be unique across all domains.`,
      );
    }
    map.set(cap.id, cap);
  }
  return map;
}

export function capabilityRegistry(): Map<string, AnyCapability> {
  if (!cached) cached = buildRegistry();
  return cached;
}

export function getCapability(id: string): AnyCapability | undefined {
  return capabilityRegistry().get(id);
}

export function listCapabilities(domain?: CapabilityDomain): AnyCapability[] {
  const all = Array.from(capabilityRegistry().values());
  return domain ? all.filter((c) => c.domain === domain) : all;
}

/**
 * Coverage assertion used by the Phase 0 test: every legacy tool id must be
 * present in the registry. Throws with the missing list so Phase 6 cutover
 * can't silently drop a capability.
 */
export function assertLegacyCoverage(legacyIds: readonly string[]): void {
  const reg = capabilityRegistry();
  const missing = legacyIds.filter((id) => !reg.has(id));
  if (missing.length > 0) {
    throw new Error(
      `[capabilityRegistry] Missing capabilities for legacy ids: ${missing.join(", ")}`,
    );
  }
}

/**
 * Canonical list of legacy CommandBar tool ids. Updated as we extract each
 * domain module. Phase 6 cutover deletes nothing until this list is fully
 * covered AND the route.ts inline tools are removed.
 */
export const LEGACY_COMMAND_BAR_TOOL_IDS = [
  // treasury
  "create_multisig",
  "transfer",
  "mass_dispatch",
  "multisig_proposal",
  // trading (next turn)
  "swap",
  "execute_swap",
  "bridge",
  "deploy_sniper_bot",
  // yield (next turn)
  "stake",
  "yield_deposit",
  "yield_withdraw",
  "rebalance",
  "execute_dca",
  // intel
  "foresight_simulation",
  "risk_assessment",
  "browser_research",
  "idl_extraction",
  "sentiment_analysis",
  "security_firewall",
  "protocol_sdk_analyze",
  // studio
  "studio_init_miniapp",
  "studio_analyze_code",
  "marketplace_publish",
  "sdk_hooks",
  "get_project_by_id",
  "get_project_by_name",
  "list_recent_projects",
  "get_studio_project_link",
  // dynamic
  "propose_dynamic_tool",
  "run_composed_tool_plan",
  "sandbox_execute_dynamic_tool",
  // misc
  "navigate",
  "set_monitor",
  "mcp_verify",
] as const;

export type LegacyCommandBarToolId = (typeof LEGACY_COMMAND_BAR_TOOL_IDS)[number];
