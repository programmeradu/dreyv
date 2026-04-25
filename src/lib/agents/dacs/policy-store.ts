/**
 * DACS Phase 2 — Per-user agent policy loader.
 *
 * Wraps `user_agent_policy` with a lazy "load with safe defaults" helper so
 * the router can call it inline without a try/catch on every request.
 * Default = require approval for everything (most conservative posture).
 */

import { db } from "@/db";
import { userAgentPolicy } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { RouteOptions } from "./route";

/** Conservative default: nothing auto-executes. */
export const DEFAULT_POLICY: NonNullable<RouteOptions["policy"]> = {
  autoApproveBelowUsd: 0,
  protocolAllowlist: [],
  protocolDenylist: [],
};

export async function loadUserPolicy(walletAddress: string | null): Promise<NonNullable<RouteOptions["policy"]>> {
  if (!walletAddress || !db) return DEFAULT_POLICY;
  try {
    const [row] = await db
      .select()
      .from(userAgentPolicy)
      .where(eq(userAgentPolicy.walletAddress, walletAddress))
      .limit(1);
    if (!row) return DEFAULT_POLICY;
    return {
      autoApproveBelowUsd: row.autoApproveBelowUsd ? Number(row.autoApproveBelowUsd) : 0,
      requireMultisigAboveUsd: row.requireMultisigAboveUsd
        ? Number(row.requireMultisigAboveUsd)
        : undefined,
      protocolAllowlist: Array.isArray(row.protocolAllowlist)
        ? (row.protocolAllowlist as string[])
        : [],
      protocolDenylist: Array.isArray(row.protocolDenylist)
        ? (row.protocolDenylist as string[])
        : [],
    };
  } catch (err) {
    console.warn("[dacs:policy] loadUserPolicy failed; using defaults:", err);
    return DEFAULT_POLICY;
  }
}

export interface UpsertPolicyInput {
  walletAddress: string;
  autoApproveBelowUsd?: number;
  requireMultisigAboveUsd?: number | null;
  protocolAllowlist?: string[];
  protocolDenylist?: string[];
  allowDynamicWrites?: boolean;
  dailyValueCapUsd?: number | null;
}

export async function upsertUserPolicy(input: UpsertPolicyInput) {
  if (!db) throw new Error("DB not initialized");
  const values = {
    walletAddress: input.walletAddress,
    autoApproveBelowUsd:
      input.autoApproveBelowUsd != null ? String(input.autoApproveBelowUsd) : "0",
    requireMultisigAboveUsd:
      input.requireMultisigAboveUsd != null ? String(input.requireMultisigAboveUsd) : null,
    protocolAllowlist: input.protocolAllowlist ?? [],
    protocolDenylist: input.protocolDenylist ?? [],
    allowDynamicWrites: input.allowDynamicWrites ?? false,
    dailyValueCapUsd:
      input.dailyValueCapUsd != null ? String(input.dailyValueCapUsd) : null,
    updatedAt: new Date(),
  };
  return db
    .insert(userAgentPolicy)
    .values(values)
    .onConflictDoUpdate({
      target: userAgentPolicy.walletAddress,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
}
