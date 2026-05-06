/**
 * Phase: Billing gating.
 *
 * Maps capability ids → minimum tier. Read/sim/meta and small write
 * capabilities default to "free". Heavy automation, autopilots, multi-step
 * composers, and Squads multisig automation require "mini" or "max".
 *
 * Helpers compare a user's tier against a capability's minTier so the DACS
 * router and CommandBar planner can reject (or queue with upgrade prompt)
 * before execution.
 */
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export type Tier = "free" | "mini" | "max";

const ORDER: Record<Tier, number> = { free: 0, mini: 1, max: 2 };

export const CAPABILITY_TIER_GATES: Record<string, Tier> = {
  // Free → discovery + small one-shot moves
  // Mini → autopilots, Squads proposals, dynamic compositions
  multisig_proposal: "mini",
  mass_dispatch: "mini",
  yield_deposit: "mini",
  yield_withdraw: "mini",
  rebalance: "mini",
  execute_dca: "mini",
  deploy_sniper_bot: "mini",
  propose_dynamic_tool: "mini",
  run_composed_tool_plan: "mini",
  sandbox_execute_dynamic_tool: "mini",
  provision_agent_signer: "mini",
  set_kill_switch: "mini",
  // Max → fleet + cross-vault scale
  marketplace_publish: "max",
  protocol_sdk_analyze: "max",
};

export function gateFor(capabilityId: string): Tier {
  return CAPABILITY_TIER_GATES[capabilityId] ?? "free";
}

export function tierAllows(userTier: Tier, required: Tier): boolean {
  return ORDER[userTier] >= ORDER[required];
}

export async function getUserTier(walletAddress?: string | null): Promise<Tier> {
  if (!db || !walletAddress) return "free";
  const [u] = await db.select({ tier: users.tier }).from(users).where(eq(users.walletAddress, walletAddress)).limit(1);
  const t = (u?.tier ?? "free") as Tier;
  return (t in ORDER ? t : "free") as Tier;
}

export interface TierVerdict {
  allowed: boolean;
  blockingId?: string;
  required?: Tier;
  userTier: Tier;
}

export function verifyPlanTier(steps: { capabilityId: string }[], userTier: Tier): TierVerdict {
  for (const s of steps) {
    const required = gateFor(s.capabilityId);
    if (!tierAllows(userTier, required)) {
      return { allowed: false, blockingId: s.capabilityId, required, userTier };
    }
  }
  return { allowed: true, userTier };
}
