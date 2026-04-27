/**
 * Durable storage helpers for the brain pipeline.
 *
 * Wraps Drizzle inserts/updates so the Inngest steps stay tiny and
 * the rest of the pipeline doesn't import the DB client directly.
 * Every helper degrades gracefully when `DATABASE_URL` is missing —
 * we log and return `null` so the bus stays alive in dev.
 */
import { db } from "@/db";
import { agentProposals, agentSubagents, agentTxProposals } from "@/db/schema";
import { eq, and, desc, lt } from "drizzle-orm";
import type { DeepProposal } from "./gemini-deep";
import type { TriageResult, OpportunitySummary } from "./groq-triage";
import type { SubAgentSpec } from "./reflector";

export interface PersistedProposal {
  id: string;
  kind: "proposal" | "alert";
  title: string;
  status: string;
}

export async function savePropagatedProposal(args: {
  proposal: DeepProposal;
  triage: TriageResult;
  opp: OpportunitySummary;
  userId?: string | null;
}): Promise<PersistedProposal | null> {
  if (!db) {
    console.warn("[brains:storage] DATABASE_URL missing — skipping proposal persist");
    return null;
  }
  try {
    const [row] = await db
      .insert(agentProposals)
      .values({
        kind: args.proposal.kind,
        title: args.proposal.title,
        thesis: args.proposal.thesis,
        actions: args.proposal.actions as unknown as object[],
        riskNotes: args.proposal.riskNotes as unknown as object[],
        confidence: String(args.proposal.confidence),
        horizon: args.proposal.horizon,
        model: args.proposal.model,
        triage: args.triage as unknown as object,
        opp: args.opp as unknown as object,
        tags: args.triage.tags as unknown as object[],
        status: "open",
        userId: args.userId ?? null,
        observedAt: new Date(args.opp.observedAt ?? Date.now()),
      })
      .returning({
        id: agentProposals.id,
        kind: agentProposals.kind,
        title: agentProposals.title,
        status: agentProposals.status,
      });
    return row as PersistedProposal;
  } catch (e: any) {
    console.warn("[brains:storage] proposal persist failed", e?.message);
    return null;
  }
}

export async function saveAlertOnly(args: {
  triage: TriageResult;
  opp: OpportunitySummary;
  userId?: string | null;
}): Promise<PersistedProposal | null> {
  if (!db) return null;
  try {
    const [row] = await db
      .insert(agentProposals)
      .values({
        kind: "alert",
        title: args.triage.reason.slice(0, 80) || "Watch signal",
        thesis: `Triage flagged "${args.triage.reason}" with confidence ${args.triage.confidence.toFixed(2)}.`,
        actions: [{ op: "alert_only", params: {}, rationale: args.triage.reason }],
        riskNotes: [],
        confidence: String(args.triage.confidence),
        horizon: "hours",
        model: args.triage.model,
        triage: args.triage as unknown as object,
        opp: args.opp as unknown as object,
        tags: args.triage.tags as unknown as object[],
        status: "open",
        userId: args.userId ?? null,
        observedAt: new Date(args.opp.observedAt ?? Date.now()),
      })
      .returning({
        id: agentProposals.id,
        kind: agentProposals.kind,
        title: agentProposals.title,
        status: agentProposals.status,
      });
    return row as PersistedProposal;
  } catch (e: any) {
    console.warn("[brains:storage] alert persist failed", e?.message);
    return null;
  }
}

export async function saveSubAgentSpec(spec: SubAgentSpec & { userId?: string | null }): Promise<boolean> {
  if (!db) return false;
  try {
    const expires = new Date(Date.now() + spec.ttlMinutes * 60_000);
    await db
      .insert(agentSubagents)
      .values({
        id: spec.id,
        name: spec.name,
        goal: spec.goal,
        triggers: spec.triggers as unknown as object[],
        capabilities: spec.capabilities as unknown as object[],
        parent: spec.parent,
        status: "active",
        ttlMinutes: spec.ttlMinutes,
        expiresAt: expires,
        notes: spec.notes,
        spec: spec as unknown as object,
        userId: spec.userId ?? null,
      })
      .onConflictDoNothing({ target: agentSubagents.id });
    return true;
  } catch (e: any) {
    console.warn("[brains:storage] subagent persist failed", e?.message);
    return false;
  }
}

export async function resolveUserIdFromWallet(walletAddress?: string | null): Promise<string | null> {
  if (!db || !walletAddress) return null;
  try {
    const { users } = await import("@/db/schema");
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.walletAddress, walletAddress)).limit(1);
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

export async function expireSubAgents(now: Date = new Date()): Promise<number> {
  if (!db) return 0;
  try {
    const expired = await db
      .update(agentSubagents)
      .set({ status: "expired", updatedAt: now })
      .where(and(eq(agentSubagents.status, "active"), lt(agentSubagents.expiresAt, now)))
      .returning({ id: agentSubagents.id });
    return expired.length;
  } catch (e: any) {
    console.warn("[brains:storage] subagent expire failed", e?.message);
    return 0;
  }
}

export async function listOpenProposals(limit = 50, opts: { userId?: string | null } = {}) {
  if (!db) return [];
  try {
    const where = opts.userId
      ? and(eq(agentProposals.status, "open"), eq(agentProposals.userId, opts.userId))
      : eq(agentProposals.status, "open");
    return await db
      .select()
      .from(agentProposals)
      .where(where)
      .orderBy(desc(agentProposals.createdAt))
      .limit(limit);
  } catch (e: any) {
    console.warn("[brains:storage] list proposals failed", e?.message);
    return [];
  }
}

export async function listActiveSubAgents(limit = 50, opts: { userId?: string | null } = {}) {
  if (!db) return [];
  try {
    const where = opts.userId
      ? and(eq(agentSubagents.status, "active"), eq(agentSubagents.userId, opts.userId))
      : eq(agentSubagents.status, "active");
    return await db
      .select()
      .from(agentSubagents)
      .where(where)
      .orderBy(desc(agentSubagents.createdAt))
      .limit(limit);
  } catch (e: any) {
    console.warn("[brains:storage] list subagents failed", e?.message);
    return [];
  }
}

export async function setProposalStatus(
  id: string,
  status: "open" | "dismissed" | "acted" | "expired",
): Promise<boolean> {
  if (!db) return false;
  try {
    const now = new Date();
    const patch: Record<string, unknown> = { status };
    if (status === "dismissed") patch.dismissedAt = now;
    if (status === "acted") patch.actedAt = now;
    await db.update(agentProposals).set(patch).where(eq(agentProposals.id, id));
    return true;
  } catch (e: any) {
    console.warn("[brains:storage] set proposal status failed", e?.message);
    return false;
  }
}

// ─── HITL transaction queue ──────────────────────────────────────────

export interface InsertTxProposalInput {
  userId?: string | null;
  proposalId?: string | null;
  chain?: string;
  kind: string; // swap | transfer | stake | rebalance | mass-send | unknown
  summary: string;
  unsignedTx?: string | null;
  instructions?: unknown[] | null;
  estimatedFeeSol?: number | null;
  riskLevel?: "low" | "medium" | "high";
  routing?: "wallet" | "multisig";
  multisigVault?: string | null;
  meta?: Record<string, unknown> | null;
  ttlMinutes?: number; // default 60
}

export async function insertTxProposal(input: InsertTxProposalInput): Promise<{ id: string } | null> {
  if (!db) {
    console.warn("[brains:storage] DATABASE_URL missing — insertTxProposal skipped");
    return null;
  }
  try {
    const ttlMin = input.ttlMinutes ?? 60;
    const [row] = await db
      .insert(agentTxProposals)
      .values({
        userId: input.userId ?? null,
        proposalId: input.proposalId ?? null,
        chain: input.chain ?? "solana",
        kind: input.kind,
        summary: input.summary,
        unsignedTx: input.unsignedTx ?? null,
        instructions: (input.instructions ?? null) as unknown as object,
        estimatedFeeSol:
          input.estimatedFeeSol != null ? String(input.estimatedFeeSol) : null,
        riskLevel: input.riskLevel ?? "medium",
        routing: input.routing ?? "wallet",
        multisigVault: input.multisigVault ?? null,
        status: "queued",
        meta: (input.meta ?? null) as unknown as object,
        expiresAt: new Date(Date.now() + ttlMin * 60_000),
      })
      .returning({ id: agentTxProposals.id });
    return row ?? null;
  } catch (e: any) {
    console.warn("[brains:storage] insertTxProposal failed", e?.message);
    return null;
  }
}

export async function listQueuedTxProposals(
  limit = 50,
  opts: { userId?: string | null; status?: string } = {},
) {
  if (!db) return [];
  try {
    const status = opts.status ?? "queued";
    const where = opts.userId
      ? and(eq(agentTxProposals.status, status), eq(agentTxProposals.userId, opts.userId))
      : eq(agentTxProposals.status, status);
    return await db
      .select()
      .from(agentTxProposals)
      .where(where)
      .orderBy(desc(agentTxProposals.createdAt))
      .limit(limit);
  } catch (e: any) {
    console.warn("[brains:storage] list tx proposals failed", e?.message);
    return [];
  }
}

export async function getTxProposal(id: string) {
  if (!db) return null;
  try {
    const rows = await db.select().from(agentTxProposals).where(eq(agentTxProposals.id, id)).limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function updateTxProposalStatus(
  id: string,
  patch: {
    status: "queued" | "approved" | "submitted" | "confirmed" | "failed" | "rejected" | "expired";
    signature?: string | null;
    errorMessage?: string | null;
  },
): Promise<boolean> {
  if (!db) return false;
  try {
    const now = new Date();
    const set: Record<string, unknown> = { status: patch.status, updatedAt: now };
    if (patch.signature !== undefined) set.signature = patch.signature;
    if (patch.errorMessage !== undefined) set.errorMessage = patch.errorMessage;
    if (patch.status === "approved") set.approvedAt = now;
    if (patch.status === "submitted") set.submittedAt = now;
    if (patch.status === "confirmed") set.confirmedAt = now;
    await db.update(agentTxProposals).set(set).where(eq(agentTxProposals.id, id));
    return true;
  } catch (e: any) {
    console.warn("[brains:storage] update tx proposal failed", e?.message);
    return false;
  }
}

export async function expireStaleTxProposals(now: Date = new Date()): Promise<number> {
  if (!db) return 0;
  try {
    const expired = await db
      .update(agentTxProposals)
      .set({ status: "expired", updatedAt: now })
      .where(and(eq(agentTxProposals.status, "queued"), lt(agentTxProposals.expiresAt, now)))
      .returning({ id: agentTxProposals.id });
    return expired.length;
  } catch (e: any) {
    console.warn("[brains:storage] expire tx proposals failed", e?.message);
    return 0;
  }
}
