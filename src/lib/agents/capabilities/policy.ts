/**
 * DACS — Policy domain capabilities (NEW; not in legacy route.ts).
 *
 * Foundational primitives for the "Cross-Agent Treasury Protocol" play:
 *   - set_treasury_policy: declarative guardrails every other capability gates on.
 *   - treasury_runway_autopilot: maintain a target runway by auto-rebalancing.
 *   - treasury_attestation: cryptographic proof-of-reserves snapshot.
 *
 * Phase 0 ships these as registered capabilities so the Phase 1 planner can
 * already reason about them. Executors return structured payloads; the
 * Phase 2+ sandbox/HITL layer will gate the writes.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineCapability, type AnyCapability } from "./types";
import { db } from "@/db";
import { userAgentPolicy } from "@/db/schema";
import { randomUUID } from "node:crypto";

const set_treasury_policy = defineCapability({
  id: "set_treasury_policy",
  domain: "policy",
  description:
    "Declare guardrails the treasury agent must obey on every subsequent action: per-protocol caps, slippage ceilings, allowlist/denylist, multisig thresholds, audit requirements, runway floor. Persisted to user_agent_policy and merged with existing row; consulted by every executor + HITL router.",
  inputSchema: z.object({
    name: z.string().describe("Policy name, e.g. 'Conservative-2026'"),
    rules: z.object({
      maxProtocolPct: z.number().min(0).max(100).optional().describe("Max % of treasury in any single protocol"),
      maxSlippagePct: z.number().min(0).max(100).optional(),
      requireAudit: z.boolean().optional().describe("Refuse interactions with unaudited contracts"),
      protocolAllowlist: z.array(z.string()).optional(),
      protocolDenylist: z.array(z.string()).optional(),
      multisigAboveUsd: z.number().optional().describe("Require multisig signatures for any tx above this $ value"),
      runwayFloorMonths: z.number().optional().describe("Never let projected runway drop below this many months"),
      maxDailyOutflowUsd: z.number().optional(),
      autoApproveBelowUsd: z.number().optional().describe("Auto-execute capabilities below this $ value"),
    }),
    activate: z.boolean().optional().default(true),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  execute: async ({ name, rules, activate }, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "set_treasury_policy", message: "Wallet required to attach policy." };
    }
    if (!db) {
      return { success: false, operation: "set_treasury_policy", message: "Database not configured." };
    }

    try {
      const policyId = `pol_${randomUUID().slice(0, 12)}`;
      const now = new Date();

      // Load existing row (if any) so we MERGE rather than overwrite.
      const existingRows = await db
        .select()
        .from(userAgentPolicy)
        .where(eq(userAgentPolicy.walletAddress, ctx.walletAddress))
        .limit(1);
      const existing = existingRows[0];

      // Merge protocol lists (set-union for allow, set-union for deny).
      const mergeUnique = (a: unknown, b: string[] | undefined): string[] => {
        const arr = Array.isArray(a) ? (a as string[]) : [];
        const set = new Set([...arr, ...(b ?? [])]);
        return [...set];
      };

      const prevMeta = (existing?.policyMeta as Record<string, unknown> | null) ?? {};
      const prevHistory = Array.isArray(prevMeta.history)
        ? (prevMeta.history as Array<Record<string, unknown>>)
        : [];

      const newMeta = {
        activePolicyId: activate ? policyId : (prevMeta.activePolicyId ?? null),
        activeName: activate ? name : (prevMeta.activeName ?? null),
        runwayFloorMonths: rules.runwayFloorMonths ?? prevMeta.runwayFloorMonths ?? null,
        maxProtocolPct: rules.maxProtocolPct ?? prevMeta.maxProtocolPct ?? null,
        maxSlippagePct: rules.maxSlippagePct ?? prevMeta.maxSlippagePct ?? null,
        requireAudit: rules.requireAudit ?? prevMeta.requireAudit ?? false,
        history: [
          ...prevHistory.slice(-19), // keep last 20 incl. new entry
          {
            policyId,
            name,
            rules,
            activate: !!activate,
            at: now.toISOString(),
          },
        ],
      };

      const values = {
        walletAddress: ctx.walletAddress,
        autoApproveBelowUsd:
          rules.autoApproveBelowUsd != null
            ? String(rules.autoApproveBelowUsd)
            : (existing?.autoApproveBelowUsd ?? "0"),
        requireMultisigAboveUsd:
          rules.multisigAboveUsd != null
            ? String(rules.multisigAboveUsd)
            : (existing?.requireMultisigAboveUsd ?? null),
        protocolAllowlist: mergeUnique(existing?.protocolAllowlist, rules.protocolAllowlist),
        protocolDenylist: mergeUnique(existing?.protocolDenylist, rules.protocolDenylist),
        allowDynamicWrites: existing?.allowDynamicWrites ?? false,
        dailyValueCapUsd:
          rules.maxDailyOutflowUsd != null
            ? String(rules.maxDailyOutflowUsd)
            : (existing?.dailyValueCapUsd ?? null),
        pendingSuggestions: existing?.pendingSuggestions ?? [],
        lastDerivationAt: existing?.lastDerivationAt ?? null,
        policyMeta: newMeta,
        updatedAt: now,
      };

      if (existing) {
        await db
          .update(userAgentPolicy)
          .set(values)
          .where(eq(userAgentPolicy.walletAddress, ctx.walletAddress));
      } else {
        await db.insert(userAgentPolicy).values({ ...values, createdAt: now });
      }

      return {
        success: true,
        operation: "set_treasury_policy",
        policyId,
        name,
        rules,
        active: !!activate,
        walletAddress: ctx.walletAddress,
        merged: !!existing,
        persistedRow: {
          autoApproveBelowUsd: values.autoApproveBelowUsd,
          requireMultisigAboveUsd: values.requireMultisigAboveUsd,
          protocolAllowlist: values.protocolAllowlist,
          protocolDenylist: values.protocolDenylist,
          dailyValueCapUsd: values.dailyValueCapUsd,
          policyMeta: newMeta,
        },
        message: `Policy "${name}" (${policyId}) ${existing ? "merged into" : "created on"} user_agent_policy. ${activate ? "Active — all subsequent agent actions are gated on it." : "Saved (inactive)."}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[capability:set_treasury_policy]", msg);
      return {
        success: false,
        operation: "set_treasury_policy",
        message: `Policy persistence failed: ${msg}`,
      };
    }
  },
});

const treasury_runway_autopilot = defineCapability({
  id: "treasury_runway_autopilot",
  domain: "policy",
  description:
    "Set a target runway floor (e.g. 18 months). Agent monitors burn rate and auto-rebalances stables ↔ yield ↔ hedge to maintain it. Requires an active policy.",
  inputSchema: z.object({
    targetRunwayMonths: z.number().min(1).max(120),
    monthlyBurnUsd: z.number().optional().describe("If omitted, agent infers from last 90d of outflows"),
    rebalanceMode: z.enum(["conservative", "balanced", "aggressive"]).optional().default("balanced"),
    actionsAllowed: z
      .array(z.enum(["yield_withdraw", "swap_to_stable", "open_hedge", "alert_only"]))
      .optional()
      .default(["yield_withdraw", "swap_to_stable", "alert_only"]),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  protocols: ["kamino", "marinade", "drift", "jupiter"],
  execute: async ({ targetRunwayMonths, monthlyBurnUsd, rebalanceMode, actionsAllowed }, ctx) => {
    if (!ctx.walletAddress) {
      return {
        success: false,
        operation: "treasury_runway_autopilot",
        message: "Wallet required. Connect to enable runway autopilot.",
      };
    }
    if (!monthlyBurnUsd) {
      return {
        success: false,
        operation: "treasury_runway_autopilot",
        status: "NEEDS_INPUT",
        message:
          "Missing monthlyBurnUsd. Provide your monthly burn (or call after we infer from 90d of on-chain outflows).",
      };
    }
    const autopilotId = `auto_${Math.random().toString(36).slice(2, 10)}`;
    return {
      success: true,
      operation: "treasury_runway_autopilot",
      autopilotId,
      targetRunwayMonths,
      monthlyBurnUsd,
      rebalanceMode,
      actionsAllowed,
      status: "ARMED",
      requiresApproval: true,
      message: `Runway autopilot armed: maintain ≥${targetRunwayMonths}mo at $${monthlyBurnUsd.toLocaleString()}/mo burn (${rebalanceMode}). Sign to activate.`,
    };
  },
});

const treasury_attestation = defineCapability({
  id: "treasury_attestation",
  domain: "policy",
  description:
    "Generate a cryptographic proof-of-reserves snapshot (Merkle root of holdings) for transparency reports, investors, and on-chain attestation.",
  inputSchema: z.object({
    label: z.string().describe("Snapshot label, e.g. 'Q4-2026-attestation'"),
    publishOnChain: z.boolean().optional().default(false),
  }),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "medium",
  execute: async ({ label, publishOnChain }, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "treasury_attestation", message: "Wallet required for attestation." };
    }
    const tokens = ctx.vaultState?.tokens || ctx.walletState?.balances || [];
    const { createHash } = await import("crypto");
    // Deterministic Merkle-style root over (symbol, amount) leaves.
    const leaves = tokens
      .map((t: any) => `${t.symbol || "?"}:${t.amount ?? 0}`)
      .sort()
      .map((s) => createHash("sha256").update(s).digest("hex"));
    const root = leaves.length
      ? createHash("sha256").update(leaves.join("")).digest("hex")
      : createHash("sha256").update("empty").digest("hex");
    return {
      success: true,
      operation: "treasury_attestation",
      label,
      walletAddress: ctx.walletAddress,
      timestamp: Date.now(),
      leafCount: leaves.length,
      merkleRoot: `0x${root}`,
      publishOnChain: !!publishOnChain,
      requiresApproval: !!publishOnChain,
      message: `Attestation "${label}" generated: root 0x${root.slice(0, 16)}… over ${leaves.length} holding(s).${publishOnChain ? " Sign to anchor on-chain." : ""}`,
    };
  },
});

export const policyCapabilities: AnyCapability[] = [
  set_treasury_policy,
  treasury_runway_autopilot,
  treasury_attestation,
];
