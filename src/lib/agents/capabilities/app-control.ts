/**
 * DACS — App-control capabilities.
 *
 * These tools let the CommandBar control surfaces that previously only had
 * UI affordances: vaults, monitors/alerts, subagents (DACS recurring),
 * knowledge memory, pending tx proposals, and active treasury policy.
 *
 * Design principles:
 *   - Read tools are sideEffects:"read", sensitivity:"low"  → safe to chain.
 *   - Write tools that only mutate our DB are sideEffects:"meta",
 *     sensitivity:"low|medium" depending on blast radius.
 *   - Anything that produces an on-chain action stays in its domain module
 *     and goes through `agent_tx_proposals` (HITL).
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";
import { db } from "@/db";
import {
  vaults,
  monitors,
  knowledgeEntries,
  agentTxProposals,
  userAgentPolicy,
  dacsSubagents,
  agentEpisodes,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { resolveUserIdFromWallet } from "@/lib/agents/brains/storage";

function notReady(operation: string, message = "Backend unavailable") {
  return { success: false as const, operation, message };
}
function needWallet(operation: string) {
  return { success: false as const, operation, message: "Connect a wallet to use this capability." };
}

// ─── Vault registry ─────────────────────────────────────────────────
const list_vaults = defineCapability({
  id: "list_vaults",
  domain: "treasury",
  description: "List every vault registered to the connected user (connected wallet, watch-only addresses, Squads multisigs).",
  inputSchema: z.object({}).default({}),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (_input, ctx) => {
    if (!db) return notReady("list_vaults");
    if (!ctx.walletAddress) return needWallet("list_vaults");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    if (!userId) return { success: true, operation: "list_vaults", vaults: [], message: "No user record yet — sign in first." };
    const rows = await db.select().from(vaults).where(eq(vaults.userId, userId)).orderBy(desc(vaults.createdAt));
    return {
      success: true,
      operation: "list_vaults",
      activeVault: ctx.vaultAddress || ctx.walletAddress,
      vaults: rows.map((v) => ({ id: v.id, address: v.address, label: v.label, kind: v.kind, isMultisig: v.isMultisig })),
      message: `${rows.length} vault${rows.length === 1 ? "" : "s"} registered.`,
    };
  },
});

const add_watch_vault = defineCapability({
  id: "add_watch_vault",
  domain: "treasury",
  description: "Add a read-only Solana address to the vault registry so the agent can monitor and reason over it. Does NOT grant signing rights.",
  inputSchema: z.object({
    address: z.string().min(32).max(64).describe("Solana address to watch"),
    label: z.string().max(64).optional(),
  }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("add_watch_vault");
    if (!ctx.walletAddress) return needWallet("add_watch_vault");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    if (!userId) return { success: false, operation: "add_watch_vault", message: "No user record." };
    const existing = await db.select().from(vaults).where(eq(vaults.address, input.address)).limit(1);
    if (existing.length > 0) {
      return { success: true, operation: "add_watch_vault", vaultId: existing[0].id, message: `${input.address.slice(0, 8)}… is already in the registry as "${existing[0].label}".` };
    }
    const [row] = await db.insert(vaults).values({
      userId,
      address: input.address,
      label: input.label || `Watch ${input.address.slice(0, 6)}…`,
      kind: "watch",
      isMultisig: false,
    }).returning();
    return { success: true, operation: "add_watch_vault", vaultId: row?.id, message: `Added watch vault "${row?.label}" (${input.address.slice(0, 8)}…).` };
  },
});

const rename_vault = defineCapability({
  id: "rename_vault",
  domain: "treasury",
  description: "Rename a vault in the registry.",
  inputSchema: z.object({ address: z.string().min(32), label: z.string().min(1).max(64) }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("rename_vault");
    if (!ctx.walletAddress) return needWallet("rename_vault");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    if (!userId) return { success: false, operation: "rename_vault", message: "No user record." };
    const [row] = await db.update(vaults).set({ label: input.label })
      .where(and(eq(vaults.userId, userId), eq(vaults.address, input.address))).returning();
    if (!row) return { success: false, operation: "rename_vault", message: `Vault ${input.address.slice(0, 8)}… not found in your registry.` };
    return { success: true, operation: "rename_vault", message: `Renamed to "${input.label}".` };
  },
});

const remove_vault = defineCapability({
  id: "remove_vault",
  domain: "treasury",
  description: "Remove a watch-only or multisig vault from the registry. Cannot remove the connected wallet.",
  inputSchema: z.object({ address: z.string().min(32) }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "medium",
  execute: async (input, ctx) => {
    if (!db) return notReady("remove_vault");
    if (!ctx.walletAddress) return needWallet("remove_vault");
    if (input.address === ctx.walletAddress) {
      return { success: false, operation: "remove_vault", message: "Cannot remove the connected wallet from the registry." };
    }
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    if (!userId) return { success: false, operation: "remove_vault", message: "No user record." };
    const res = await db.delete(vaults).where(and(eq(vaults.userId, userId), eq(vaults.address, input.address))).returning({ id: vaults.id });
    if (res.length === 0) return { success: false, operation: "remove_vault", message: `Vault ${input.address.slice(0, 8)}… not found.` };
    return { success: true, operation: "remove_vault", message: `Removed ${input.address.slice(0, 8)}… from the registry.` };
  },
});

const switch_vault = defineCapability({
  id: "switch_vault",
  domain: "treasury",
  description: "Switch the active treasury vault to a different registered address. Returns the new active vault so the UI can update.",
  inputSchema: z.object({ address: z.string().min(32) }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("switch_vault");
    if (!ctx.walletAddress) return needWallet("switch_vault");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    if (!userId) return { success: false, operation: "switch_vault", message: "No user record." };
    const [row] = await db.select().from(vaults).where(and(eq(vaults.userId, userId), eq(vaults.address, input.address))).limit(1);
    if (!row) return { success: false, operation: "switch_vault", message: `Vault ${input.address.slice(0, 8)}… is not in your registry. Use add_watch_vault first.` };
    return {
      success: true,
      operation: "switch_vault",
      activeVault: row.address,
      label: row.label,
      kind: row.kind,
      // UI side-effect: VaultSelector listens for this on the agent event bus.
      uiAction: { type: "set_active_vault", address: row.address },
      message: `Switched active vault to "${row.label}" (${row.address.slice(0, 8)}…).`,
    };
  },
});

// ─── Monitors / alerts ──────────────────────────────────────────────
const list_alerts = defineCapability({
  id: "list_alerts",
  domain: "intel",
  description: "List active monitors/alerts (price, balance, APY, risk thresholds) for the connected wallet.",
  inputSchema: z.object({ activeOnly: z.boolean().default(true) }),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("list_alerts");
    if (!ctx.walletAddress) return needWallet("list_alerts");
    const rows = await db.select().from(monitors).where(eq(monitors.walletAddress, ctx.walletAddress));
    const filtered = input.activeOnly ? rows.filter((r) => r.active) : rows;
    return {
      success: true,
      operation: "list_alerts",
      count: filtered.length,
      alerts: filtered.map((r) => ({
        id: r.id, type: r.type, target: r.target, operator: r.operator,
        threshold: Number(r.conditionValue), active: r.active,
        triggerCount: r.triggerCount, lastTriggeredAt: r.lastTriggeredAt,
      })),
      message: `${filtered.length} ${input.activeOnly ? "active " : ""}alert${filtered.length === 1 ? "" : "s"}.`,
    };
  },
});

const arm_alert = defineCapability({
  id: "arm_alert",
  domain: "intel",
  description: "Create a monitor that triggers when a metric crosses a threshold. Examples: 'when SOL drops below $130', 'when USDC balance below 1000', 'when APY above 7%'.",
  inputSchema: z.object({
    type: z.enum(["price", "balance", "apy", "risk"]),
    target: z.string().min(1).describe("Token symbol or metric name (e.g. 'SOL', 'USDC', 'jitoSOL_apy')"),
    operator: z.enum(["above", "below", "equals", "changes"]),
    threshold: z.number(),
  }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("arm_alert");
    if (!ctx.walletAddress) return needWallet("arm_alert");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    const [row] = await db.insert(monitors).values({
      walletAddress: ctx.walletAddress,
      userId: userId ?? null,
      type: input.type,
      target: input.target.toUpperCase(),
      operator: input.operator,
      conditionValue: String(input.threshold),
      active: true,
    }).returning();
    return {
      success: true,
      operation: "arm_alert",
      alertId: row?.id,
      message: `Armed: ${input.type} of ${input.target} ${input.operator} ${input.threshold}. You'll be notified when it triggers.`,
    };
  },
});

const mute_alert = defineCapability({
  id: "mute_alert",
  domain: "intel",
  description: "Pause a monitor by id without deleting it.",
  inputSchema: z.object({ id: z.number().int() }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("mute_alert");
    if (!ctx.walletAddress) return needWallet("mute_alert");
    const [row] = await db.update(monitors).set({ active: false, updatedAt: new Date() })
      .where(and(eq(monitors.id, input.id), eq(monitors.walletAddress, ctx.walletAddress))).returning();
    if (!row) return { success: false, operation: "mute_alert", message: `Alert ${input.id} not found for your wallet.` };
    return { success: true, operation: "mute_alert", message: `Alert ${input.id} muted.` };
  },
});

const delete_alert = defineCapability({
  id: "delete_alert",
  domain: "intel",
  description: "Delete a monitor permanently.",
  inputSchema: z.object({ id: z.number().int() }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "medium",
  execute: async (input, ctx) => {
    if (!db) return notReady("delete_alert");
    if (!ctx.walletAddress) return needWallet("delete_alert");
    const res = await db.delete(monitors)
      .where(and(eq(monitors.id, input.id), eq(monitors.walletAddress, ctx.walletAddress)))
      .returning({ id: monitors.id });
    if (res.length === 0) return { success: false, operation: "delete_alert", message: `Alert ${input.id} not found.` };
    return { success: true, operation: "delete_alert", message: `Deleted alert ${input.id}.` };
  },
});

// ─── Subagents (DACS recurring directives) ──────────────────────────
const list_subagents = defineCapability({
  id: "list_subagents",
  domain: "intel",
  description: "List recurring/scheduled sub-agents (DCA, monitors, recurring rebalances) registered for the connected wallet.",
  inputSchema: z.object({}).default({}),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (_input, ctx) => {
    if (!db) return notReady("list_subagents");
    if (!ctx.walletAddress) return needWallet("list_subagents");
    const rows = await db.select().from(dacsSubagents).where(eq(dacsSubagents.walletAddress, ctx.walletAddress)).orderBy(desc(dacsSubagents.createdAt)).limit(50);
    return {
      success: true,
      operation: "list_subagents",
      count: rows.length,
      subagents: rows.map((r) => ({ id: r.id, status: r.status, parentCommandId: r.parentCommandId, createdAt: r.createdAt })),
      message: `${rows.length} subagent${rows.length === 1 ? "" : "s"} registered.`,
    };
  },
});

const pause_subagent = defineCapability({
  id: "pause_subagent",
  domain: "intel",
  description: "Pause a running subagent.",
  inputSchema: z.object({ id: z.string().uuid() }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("pause_subagent");
    if (!ctx.walletAddress) return needWallet("pause_subagent");
    const [row] = await db.update(dacsSubagents).set({ status: "paused" })
      .where(and(eq(dacsSubagents.id, input.id), eq(dacsSubagents.walletAddress, ctx.walletAddress))).returning();
    if (!row) return { success: false, operation: "pause_subagent", message: `Subagent ${input.id} not found.` };
    return { success: true, operation: "pause_subagent", message: `Paused subagent ${input.id}.` };
  },
});

const kill_subagent = defineCapability({
  id: "kill_subagent",
  domain: "intel",
  description: "Permanently retire a subagent.",
  inputSchema: z.object({ id: z.string().uuid() }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "medium",
  execute: async (input, ctx) => {
    if (!db) return notReady("kill_subagent");
    if (!ctx.walletAddress) return needWallet("kill_subagent");
    const [row] = await db.update(dacsSubagents).set({ status: "completed" })
      .where(and(eq(dacsSubagents.id, input.id), eq(dacsSubagents.walletAddress, ctx.walletAddress))).returning();
    if (!row) return { success: false, operation: "kill_subagent", message: `Subagent ${input.id} not found.` };
    return { success: true, operation: "kill_subagent", message: `Retired subagent ${input.id}.` };
  },
});

// ─── Knowledge memory ───────────────────────────────────────────────
const remember_fact = defineCapability({
  id: "remember_fact",
  domain: "intel",
  description: "Persist a fact the agent should remember across sessions (e.g. 'my CFO email is x@y.com', 'always exclude wallet ABC from analytics').",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(2000),
    tags: z.array(z.string()).max(20).optional(),
  }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("remember_fact");
    if (!ctx.walletAddress) return needWallet("remember_fact");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    const [row] = await db.insert(knowledgeEntries).values({
      source: "manual",
      title: input.title,
      summary: input.summary,
      content: input.summary,
      contentType: "markdown",
      tags: input.tags ?? null,
      userId: userId ?? null,
    }).returning();
    return { success: true, operation: "remember_fact", id: row?.id, message: `Remembered: "${input.title}".` };
  },
});

const recall_facts = defineCapability({
  id: "recall_facts",
  domain: "intel",
  description: "Recall facts the user has asked the agent to remember. Optionally filter by tag substring.",
  inputSchema: z.object({ tag: z.string().optional(), limit: z.number().int().min(1).max(50).default(20) }),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("recall_facts");
    if (!ctx.walletAddress) return needWallet("recall_facts");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    if (!userId) return { success: true, operation: "recall_facts", facts: [], message: "No user record yet." };
    const rows = await db.select().from(knowledgeEntries)
      .where(and(eq(knowledgeEntries.userId, userId), eq(knowledgeEntries.source, "manual")))
      .orderBy(desc(knowledgeEntries.createdAt))
      .limit(input.limit);
    const filtered = input.tag ? rows.filter((r) => Array.isArray(r.tags) && (r.tags as string[]).some((t) => t.toLowerCase().includes(input.tag!.toLowerCase()))) : rows;
    return {
      success: true,
      operation: "recall_facts",
      count: filtered.length,
      facts: filtered.map((r) => ({ id: r.id, title: r.title, summary: r.summary, tags: r.tags, createdAt: r.createdAt })),
      message: `${filtered.length} fact${filtered.length === 1 ? "" : "s"}.`,
    };
  },
});

const forget_fact = defineCapability({
  id: "forget_fact",
  domain: "intel",
  description: "Forget a previously-remembered fact by id.",
  inputSchema: z.object({ id: z.number().int() }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "medium",
  execute: async (input, ctx) => {
    if (!db) return notReady("forget_fact");
    if (!ctx.walletAddress) return needWallet("forget_fact");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    if (!userId) return { success: false, operation: "forget_fact", message: "No user record." };
    const res = await db.delete(knowledgeEntries)
      .where(and(eq(knowledgeEntries.id, input.id), eq(knowledgeEntries.userId, userId)))
      .returning({ id: knowledgeEntries.id });
    if (res.length === 0) return { success: false, operation: "forget_fact", message: `Fact ${input.id} not found.` };
    return { success: true, operation: "forget_fact", message: `Forgot fact ${input.id}.` };
  },
});

// ─── Pending tx proposals (HITL inbox readout) ──────────────────────
const get_pending_proposals = defineCapability({
  id: "get_pending_proposals",
  domain: "treasury",
  description: "List queued/awaiting-signature transaction proposals so the user can see what's waiting for approval.",
  inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("get_pending_proposals");
    if (!ctx.walletAddress) return needWallet("get_pending_proposals");
    const userId = await resolveUserIdFromWallet(ctx.walletAddress);
    if (!userId) return { success: true, operation: "get_pending_proposals", proposals: [], message: "No user record." };
    const rows = await db.select().from(agentTxProposals)
      .where(and(eq(agentTxProposals.userId, userId), eq(agentTxProposals.status, "queued")))
      .orderBy(desc(agentTxProposals.createdAt))
      .limit(input.limit);
    return {
      success: true,
      operation: "get_pending_proposals",
      count: rows.length,
      proposals: rows.map((r) => ({ id: r.id, kind: r.kind, summary: r.summary, riskLevel: r.riskLevel, createdAt: r.createdAt, expiresAt: r.expiresAt })),
      message: `${rows.length} pending proposal${rows.length === 1 ? "" : "s"}.`,
    };
  },
});

// ─── Active policy ──────────────────────────────────────────────────
const get_active_policies = defineCapability({
  id: "get_active_policies",
  domain: "policy",
  description: "Read the active treasury policy for the connected wallet (auto-approve thresholds, allowlists, daily caps, runway floor).",
  inputSchema: z.object({}).default({}),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (_input, ctx) => {
    if (!db) return notReady("get_active_policies");
    if (!ctx.walletAddress) return needWallet("get_active_policies");
    const [row] = await db.select().from(userAgentPolicy).where(eq(userAgentPolicy.walletAddress, ctx.walletAddress)).limit(1);
    if (!row) {
      return { success: true, operation: "get_active_policies", policy: null, message: "No custom policy set — using defaults (HITL for all writes)." };
    }
    return {
      success: true,
      operation: "get_active_policies",
      policy: {
        autoApproveBelowUsd: Number(row.autoApproveBelowUsd ?? 0),
        requireMultisigAboveUsd: row.requireMultisigAboveUsd != null ? Number(row.requireMultisigAboveUsd) : null,
        dailyValueCapUsd: row.dailyValueCapUsd != null ? Number(row.dailyValueCapUsd) : null,
        protocolAllowlist: row.protocolAllowlist,
        protocolDenylist: row.protocolDenylist,
        allowDynamicWrites: row.allowDynamicWrites,
        meta: row.policyMeta,
      },
      message: `Policy loaded.`,
    };
  },
});

// ─── Recent agent actions (episodic memory) ─────────────────────────
const get_recent_actions = defineCapability({
  id: "get_recent_actions",
  domain: "intel",
  description: "Recall the last N actions the agent ran for this wallet (intent, tools used, outcome, value).",
  inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("get_recent_actions");
    if (!ctx.walletAddress) return needWallet("get_recent_actions");
    const rows = await db.select().from(agentEpisodes)
      .where(eq(agentEpisodes.walletAddress, ctx.walletAddress))
      .orderBy(desc(agentEpisodes.createdAt))
      .limit(input.limit);
    return {
      success: true,
      operation: "get_recent_actions",
      count: rows.length,
      actions: rows.map((r) => ({
        intent: r.intentKind,
        tools: r.capabilityIds,
        outcome: r.outcome,
        valueUsd: r.valueUsd != null ? Number(r.valueUsd) : null,
        at: r.createdAt,
      })),
      message: `${rows.length} recent action${rows.length === 1 ? "" : "s"}.`,
    };
  },
});

// ─── Universal context summary helpers (for the system prompt) ──────
export async function summarizePendingProposals(walletAddress: string | null): Promise<string | undefined> {
  if (!db || !walletAddress) return undefined;
  try {
    const userId = await resolveUserIdFromWallet(walletAddress);
    if (!userId) return undefined;
    const rows = await db.select().from(agentTxProposals)
      .where(and(eq(agentTxProposals.userId, userId), eq(agentTxProposals.status, "queued"))).limit(10);
    if (rows.length === 0) return undefined;
    return `Pending approvals: ${rows.length} proposal${rows.length === 1 ? "" : "s"} awaiting signature (${rows.slice(0, 3).map((r) => r.kind).join(", ")}${rows.length > 3 ? "…" : ""}). Use get_pending_proposals to list.`;
  } catch { return undefined; }
}

export async function summarizeActiveAlerts(walletAddress: string | null): Promise<string | undefined> {
  if (!db || !walletAddress) return undefined;
  try {
    const rows = await db.select().from(monitors).where(and(eq(monitors.walletAddress, walletAddress), eq(monitors.active, true))).limit(20);
    if (rows.length === 0) return undefined;
    return `Active alerts: ${rows.length} (${rows.slice(0, 3).map((r) => `${r.type}:${r.target} ${r.operator} ${r.conditionValue}`).join("; ")}${rows.length > 3 ? "…" : ""}). Use list_alerts to inspect.`;
  } catch { return undefined; }
}

export async function summarizeActivePolicy(walletAddress: string | null): Promise<string | undefined> {
  if (!db || !walletAddress) return undefined;
  try {
    const [row] = await db.select().from(userAgentPolicy).where(eq(userAgentPolicy.walletAddress, walletAddress)).limit(1);
    if (!row) return "Active policy: defaults (HITL for all writes, no auto-approve).";
    const parts: string[] = [];
    const auto = Number(row.autoApproveBelowUsd ?? 0);
    if (auto > 0) parts.push(`auto-approve <$${auto}`);
    if (row.requireMultisigAboveUsd) parts.push(`multisig >$${row.requireMultisigAboveUsd}`);
    if (row.dailyValueCapUsd) parts.push(`daily cap $${row.dailyValueCapUsd}`);
    const allow = Array.isArray(row.protocolAllowlist) ? (row.protocolAllowlist as string[]).length : 0;
    if (allow) parts.push(`${allow} protocol(s) allowlisted`);
    return `Active policy: ${parts.length ? parts.join(", ") : "defaults"}.`;
  } catch { return undefined; }
}

export async function summarizeRecentActions(walletAddress: string | null): Promise<string | undefined> {
  if (!db || !walletAddress) return undefined;
  try {
    const rows = await db.select().from(agentEpisodes)
      .where(eq(agentEpisodes.walletAddress, walletAddress))
      .orderBy(desc(agentEpisodes.createdAt))
      .limit(5);
    if (rows.length === 0) return undefined;
    return `Recent actions: ${rows.map((r) => `${r.intentKind}/${r.outcome}`).join("; ")}.`;
  } catch { return undefined; }
}

export const appControlCapabilities: AnyCapability[] = [
  list_vaults as AnyCapability,
  add_watch_vault as AnyCapability,
  rename_vault as AnyCapability,
  remove_vault as AnyCapability,
  switch_vault as AnyCapability,
  list_alerts as AnyCapability,
  arm_alert as AnyCapability,
  mute_alert as AnyCapability,
  delete_alert as AnyCapability,
  list_subagents as AnyCapability,
  pause_subagent as AnyCapability,
  kill_subagent as AnyCapability,
  remember_fact as AnyCapability,
  recall_facts as AnyCapability,
  forget_fact as AnyCapability,
  get_pending_proposals as AnyCapability,
  get_active_policies as AnyCapability,
  get_recent_actions as AnyCapability,
];
