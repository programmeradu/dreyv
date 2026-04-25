/**
 * DACS Phase 3 — Episodic memory.
 *
 * Records every settled command outcome (auto-executed, approved-then-executed,
 * rejected, expired, cancelled) so the planner can recall similar past
 * episodes when scoring a new plan. Best-effort writes — never blocks the
 * pipeline if Postgres is unreachable.
 */
import { db } from "@/db";
import { agentEpisodes } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { Intent, Plan } from "./types";

export type EpisodeOutcome =
  | "auto_executed"
  | "approved_executed"
  | "approved_failed"
  | "rejected"
  | "expired"
  | "cancelled";

export interface RecordEpisodeInput {
  commandId: string;
  walletAddress: string | null;
  intent: Intent;
  plan: Plan;
  outcome: EpisodeOutcome;
  durationMs?: number;
  signature?: string | null;
  notes?: string | null;
}

export async function recordEpisode(input: RecordEpisodeInput): Promise<string | null> {
  if (!db) return null;
  try {
    const [row] = await db
      .insert(agentEpisodes)
      .values({
        commandId: input.commandId,
        walletAddress: input.walletAddress,
        intentKind: input.intent.kind,
        capabilityIds: input.plan.steps.map((s) => s.capabilityId) as unknown as Record<string, unknown>,
        outcome: input.outcome,
        riskScore: input.plan.riskScore != null ? String(input.plan.riskScore) : null,
        valueUsd: input.plan.estimatedValueUsd != null ? String(input.plan.estimatedValueUsd) : null,
        durationMs: input.durationMs ?? null,
        signature: input.signature ?? null,
        notes: input.notes ?? null,
      })
      .returning({ id: agentEpisodes.id });
    return row?.id ?? null;
  } catch (err) {
    console.warn("[dacs:episodes] recordEpisode failed (best-effort):", err);
    return null;
  }
}

export interface EpisodeRecallSummary {
  total: number;
  byOutcome: Record<string, number>;
  recentCapabilities: string[];
  /** Approval rate among approved/rejected episodes (excludes auto_executed). */
  approvalRate: number | null;
}

/**
 * Recall summary for a wallet+intent combo. Used by the planner to bias
 * risk_score: e.g. if the user rejected the last 5 swaps > $10k, the next
 * plan should be marked higher risk and queued.
 */
export async function recallEpisodes(
  walletAddress: string | null,
  intentKind: string,
  limit = 25,
): Promise<EpisodeRecallSummary> {
  const empty: EpisodeRecallSummary = {
    total: 0,
    byOutcome: {},
    recentCapabilities: [],
    approvalRate: null,
  };
  if (!db || !walletAddress) return empty;
  try {
    const rows = await db
      .select()
      .from(agentEpisodes)
      .where(
        and(
          eq(agentEpisodes.walletAddress, walletAddress),
          eq(agentEpisodes.intentKind, intentKind),
        ),
      )
      .orderBy(desc(agentEpisodes.createdAt))
      .limit(limit);

    if (rows.length === 0) return empty;

    const byOutcome: Record<string, number> = {};
    const caps = new Set<string>();
    let approved = 0;
    let rejected = 0;
    for (const r of rows) {
      byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
      if (Array.isArray(r.capabilityIds)) {
        for (const c of r.capabilityIds as string[]) caps.add(c);
      }
      if (r.outcome === "approved_executed") approved += 1;
      if (r.outcome === "rejected") rejected += 1;
    }
    const denom = approved + rejected;
    return {
      total: rows.length,
      byOutcome,
      recentCapabilities: Array.from(caps).slice(0, 10),
      approvalRate: denom > 0 ? approved / denom : null,
    };
  } catch (err) {
    console.warn("[dacs:episodes] recallEpisodes failed:", err);
    return empty;
  }
}
