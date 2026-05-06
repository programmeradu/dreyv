/**
 * DACS — Signing capabilities (Phase 3).
 *
 * Manage agent signers and the policy caps they sign under. Provisioning a
 * session-key signer for a non-multisig vault still requires an explicit
 * user gesture (the agent proposes; the wallet signs the envelope). For
 * Squads vaults, "provision" creates a member-add proposal in the DB and
 * surfaces it to the inbox — never sends on-chain bytes silently.
 */
import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";
import { db } from "@/db";
import { agentSigners, agentCircuitBreaker, vaults } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { resolveUserIdFromWallet } from "@/lib/agents/brains/storage";

const PolicyCapsSchema = z.object({
  maxUsdPerTx: z.number().positive().optional(),
  maxUsdPerDay: z.number().positive().optional(),
  allowedProtocols: z.array(z.string()).optional(),
  allowedActions: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
});

function notReady(op: string) { return { success: false as const, operation: op, message: "Backend unavailable" }; }
function needWallet(op: string) { return { success: false as const, operation: op, message: "Connect a wallet first." }; }

const list_agent_signers = defineCapability({
  id: "list_agent_signers",
  domain: "policy",
  description: "List every agent signer (session key or Squads agent member) for the user's vaults, with policy caps and status.",
  inputSchema: z.object({ vaultId: z.string().uuid().optional() }).default({}),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("list_agent_signers");
    if (!ctx.walletAddress) return needWallet("list_agent_signers");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    if (!userId) return { success: true, operation: "list_agent_signers", signers: [] };
    const where = input.vaultId
      ? and(eq(agentSigners.userId, userId), eq(agentSigners.vaultId, input.vaultId))
      : eq(agentSigners.userId, userId);
    const rows = await db.select().from(agentSigners).where(where).orderBy(desc(agentSigners.createdAt));
    return {
      success: true,
      operation: "list_agent_signers",
      signers: rows.map((s) => ({
        id: s.id,
        vaultId: s.vaultId,
        kind: s.kind,
        pubkey: s.pubkey,
        label: s.label,
        status: s.status,
        caps: s.policyCaps,
        expiresAt: s.expiresAt,
        killSwitchAt: s.killSwitchAt,
      })),
      message: `${rows.length} signer${rows.length === 1 ? "" : "s"}.`,
    };
  },
});

const provision_agent_signer = defineCapability({
  id: "provision_agent_signer",
  domain: "policy",
  description: "Register an agent signer for a vault with policy caps. For session keys the user must approve the envelope; for Squads vaults a member-add proposal is queued.",
  inputSchema: z.object({
    vaultId: z.string().uuid(),
    kind: z.enum(["session_key", "squads_member"]),
    pubkey: z.string().min(32).max(44),
    label: z.string().optional(),
    caps: PolicyCapsSchema,
  }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "high",
  execute: async (input, ctx) => {
    if (!db) return notReady("provision_agent_signer");
    if (!ctx.walletAddress) return needWallet("provision_agent_signer");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    if (!userId) return { success: false, operation: "provision_agent_signer", message: "User not found." };

    const [vault] = await db.select().from(vaults).where(and(eq(vaults.id, input.vaultId), eq(vaults.userId, userId))).limit(1);
    if (!vault) return { success: false, operation: "provision_agent_signer", message: "Vault not found." };

    const [signer] = await db.insert(agentSigners).values({
      userId,
      vaultId: input.vaultId,
      kind: input.kind,
      pubkey: input.pubkey,
      label: input.label || (input.kind === "session_key" ? "Session key" : "Squads agent"),
      policyCaps: input.caps,
      status: input.kind === "squads_member" ? "paused" : "active",
      expiresAt: input.caps.expiresAt ? new Date(input.caps.expiresAt) : null,
    }).returning();

    return {
      success: true,
      operation: "provision_agent_signer",
      signer: { id: signer.id, status: signer.status, kind: signer.kind },
      uiAction: { type: "refresh_signers" },
      message: signer.status === "paused"
        ? "Squads member-add proposal queued. Approve in the inbox to activate."
        : "Session key registered with caps.",
    };
  },
});

const revoke_agent_signer = defineCapability({
  id: "revoke_agent_signer",
  domain: "policy",
  description: "Revoke an agent signer (kill switch). All in-flight autopilots stop until a new signer is provisioned.",
  inputSchema: z.object({ signerId: z.string().uuid(), reason: z.string().optional() }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "high",
  execute: async (input, ctx) => {
    if (!db) return notReady("revoke_agent_signer");
    if (!ctx.walletAddress) return needWallet("revoke_agent_signer");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    if (!userId) return { success: false, operation: "revoke_agent_signer", message: "User not found." };
    const [updated] = await db.update(agentSigners)
      .set({ status: "revoked", killSwitchAt: new Date() })
      .where(and(eq(agentSigners.id, input.signerId), eq(agentSigners.userId, userId)))
      .returning();
    if (!updated) return { success: false, operation: "revoke_agent_signer", message: "Signer not found." };
    return { success: true, operation: "revoke_agent_signer", uiAction: { type: "refresh_signers" }, message: "Signer revoked." };
  },
});

const set_kill_switch = defineCapability({
  id: "set_kill_switch",
  domain: "policy",
  description: "Engage or release the global kill switch for a vault. While engaged, no autopilot or auto-execute can run.",
  inputSchema: z.object({ vaultId: z.string().uuid().optional(), engage: z.boolean(), reason: z.string().optional(), freezeMinutes: z.number().int().positive().max(10080).optional() }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "high",
  execute: async (input, ctx) => {
    if (!db) return notReady("set_kill_switch");
    if (!ctx.walletAddress) return needWallet("set_kill_switch");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    if (!userId) return { success: false, operation: "set_kill_switch", message: "User not found." };
    if (input.engage) {
      await db.insert(agentCircuitBreaker).values({
        userId,
        vaultId: input.vaultId ?? null,
        scope: "autopilot",
        consecutiveFailures: 0,
        frozenUntil: new Date(Date.now() + (input.freezeMinutes ?? 1440) * 60 * 1000),
        reason: input.reason || "Manual kill switch",
      });
    } else {
      await db.update(agentCircuitBreaker)
        .set({ frozenUntil: null, reason: null })
        .where(eq(agentCircuitBreaker.userId, userId));
    }
    return {
      success: true,
      operation: "set_kill_switch",
      uiAction: { type: "refresh_breaker" },
      message: input.engage ? "Kill switch engaged. Autopilot frozen." : "Kill switch released.",
    };
  },
});

export const signingCapabilities: AnyCapability[] = [
  list_agent_signers,
  provision_agent_signer,
  revoke_agent_signer,
  set_kill_switch,
];
