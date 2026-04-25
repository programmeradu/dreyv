/**
 * DACS Phase 2 — HITL approval queue persistence.
 *
 * The router calls `enqueueApproval()` whenever a plan is too sensitive to
 * auto-execute. The /app inbox surfaces pending rows; users approve or
 * reject from there, after which Phase 3's executor settles the plan.
 *
 * Best-effort: every helper returns a fallback object on DB failure so the
 * pipeline never collapses just because Postgres is unreachable.
 */

import { db } from "@/db";
import { commandApprovals } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { Intent, Plan, RouteDecision } from "./types";

export interface EnqueueApprovalInput {
  commandId: string;
  walletAddress: string | null;
  intent: Intent;
  plan: Plan;
  decision: RouteDecision;
  /** TTL in hours. Default 24h; high-risk plans should pass shorter windows. */
  ttlHours?: number;
}

export interface ApprovalRow {
  id: string;
  commandId: string;
  walletAddress: string | null;
  status: string;
  reason: string;
  intent: Intent;
  plan: Plan;
  decision: RouteDecision;
  riskScore: number | null;
  estimatedValueUsd: number | null;
  expiresAt: Date;
  createdAt: Date;
  resolvedAt: Date | null;
  resolutionNote: string | null;
}

function ensureDb() {
  if (!db) throw new Error("DB not initialized");
  return db;
}

/** Insert a queued approval. Returns row id (or null on failure). */
export async function enqueueApproval(input: EnqueueApprovalInput): Promise<string | null> {
  try {
    const ttlMs = (input.ttlHours ?? 24) * 60 * 60 * 1000;
    const [row] = await ensureDb()
      .insert(commandApprovals)
      .values({
        commandId: input.commandId,
        walletAddress: input.walletAddress,
        status: "pending",
        reason: input.decision.reason,
        intent: input.intent as unknown as Record<string, unknown>,
        plan: input.plan as unknown as Record<string, unknown>,
        decision: input.decision as unknown as Record<string, unknown>,
        riskScore: input.plan.riskScore != null ? String(input.plan.riskScore) : null,
        estimatedValueUsd:
          input.plan.estimatedValueUsd != null ? String(input.plan.estimatedValueUsd) : null,
        expiresAt: new Date(Date.now() + ttlMs),
      })
      .returning({ id: commandApprovals.id });
    return row?.id ?? null;
  } catch (err) {
    console.warn("[dacs:hitl] enqueueApproval failed (best-effort):", err);
    return null;
  }
}

/** List pending approvals scoped to a wallet (or all when null). */
export async function listPendingApprovals(walletAddress: string | null, limit = 50) {
  try {
    const where = walletAddress
      ? and(eq(commandApprovals.status, "pending"), eq(commandApprovals.walletAddress, walletAddress))
      : eq(commandApprovals.status, "pending");
    const rows = await ensureDb()
      .select()
      .from(commandApprovals)
      .where(where)
      .orderBy(desc(commandApprovals.createdAt))
      .limit(limit);
    return rows;
  } catch (err) {
    console.warn("[dacs:hitl] listPendingApprovals failed:", err);
    return [];
  }
}

export async function getApproval(id: string) {
  try {
    const [row] = await ensureDb()
      .select()
      .from(commandApprovals)
      .where(eq(commandApprovals.id, id))
      .limit(1);
    return row ?? null;
  } catch (err) {
    console.warn("[dacs:hitl] getApproval failed:", err);
    return null;
  }
}

export type ResolveAction = "approve" | "reject" | "executed" | "expired";

export async function resolveApproval(
  id: string,
  action: ResolveAction,
  meta: { resolvedBy?: string; note?: string } = {},
) {
  const statusMap: Record<ResolveAction, string> = {
    approve: "approved",
    reject: "rejected",
    executed: "executed",
    expired: "expired",
  };
  try {
    const result = await ensureDb()
      .update(commandApprovals)
      .set({
        status: statusMap[action],
        resolvedAt: new Date(),
        resolvedBy: meta.resolvedBy ?? null,
        resolutionNote: meta.note ?? null,
      })
      .where(eq(commandApprovals.id, id))
      .returning({ id: commandApprovals.id, status: commandApprovals.status });
    return result[0] ?? null;
  } catch (err) {
    console.warn("[dacs:hitl] resolveApproval failed:", err);
    return null;
  }
}
