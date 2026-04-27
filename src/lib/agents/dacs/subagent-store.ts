/**
 * DACS Phase 4 — Sub-agent store.
 *
 * Lightweight CRUD over `dacs_subagents`. Sub-agents are spawned by the
 * router when an intent has a recurring/monitoring shape, and ticked by the
 * `subagentTicker` Inngest cron.
 *
 * All helpers are best-effort: DB failure logs and returns null/empty so the
 * pipeline never collapses.
 */
import { db } from "@/db";
import { dacsSubagents } from "@/db/schema";
import { and, desc, eq, lte } from "drizzle-orm";
import type { Intent, Plan } from "./types";
import { nextRunAfter } from "./cron";
import type { TriggerSpec } from "./triggers";

export interface SpawnSubagentInput {
  walletAddress: string | null;
  parentCommandId: string;
  title: string;
  rawText: string;
  intent: Intent;
  planTemplate: Plan;
  intervalSeconds?: number;
  /** Optional 5-field cron expression. Takes precedence over intervalSeconds. */
  cronExpr?: string | null;
  /** Optional conditional trigger spec (price / wallet / news / handoff). */
  trigger?: TriggerSpec | null;
  /** Provenance — e.g. { kind:"canvas_block", blockId, blockType, title }. */
  spawnedFrom?: Record<string, unknown> | null;
  maxTicks?: number | null;
  expiresAt?: Date | null;
}

/**
 * Compute the next run time. Cron expression wins when supplied & valid;
 * otherwise we fall back to interval-from-now (legacy behavior).
 */
function computeNextRun(intervalSeconds: number, cronExpr: string | null | undefined): Date {
  if (cronExpr) {
    const next = nextRunAfter(cronExpr, new Date());
    if (next) return next;
  }
  return new Date(Date.now() + intervalSeconds * 1000);
}

export async function spawnSubagent(input: SpawnSubagentInput): Promise<string | null> {
  if (!db) return null;
  try {
    const interval = Math.max(60, input.intervalSeconds ?? 86_400);
    const cronExpr = input.cronExpr?.trim() || null;
    const nextRunAt = computeNextRun(interval, cronExpr);
    const [row] = await db
      .insert(dacsSubagents)
      .values({
        walletAddress: input.walletAddress,
        parentCommandId: input.parentCommandId,
        title: input.title.slice(0, 120),
        rawText: input.rawText,
        intent: input.intent as unknown as Record<string, unknown>,
        planTemplate: input.planTemplate as unknown as Record<string, unknown>,
        intervalSeconds: interval,
        cronExpr,
        trigger: (input.trigger ?? null) as unknown as Record<string, unknown> | null,
        spawnedFrom: (input.spawnedFrom ?? null) as Record<string, unknown> | null,
        nextRunAt,
        maxTicks: input.maxTicks ?? null,
        expiresAt: input.expiresAt ?? null,
      })
      .returning({ id: dacsSubagents.id });
    return row?.id ?? null;
  } catch (err) {
    console.warn("[dacs:subagent] spawn failed:", err);
    return null;
  }
}

export async function listSubagents(walletAddress: string | null, limit = 50) {
  if (!db) return [];
  try {
    const where = walletAddress
      ? eq(dacsSubagents.walletAddress, walletAddress)
      : undefined;
    return await db
      .select()
      .from(dacsSubagents)
      .where(where as never)
      .orderBy(desc(dacsSubagents.createdAt))
      .limit(limit);
  } catch (err) {
    console.warn("[dacs:subagent] list failed:", err);
    return [];
  }
}

export async function getSubagent(id: string) {
  if (!db) return null;
  try {
    const [row] = await db
      .select()
      .from(dacsSubagents)
      .where(eq(dacsSubagents.id, id))
      .limit(1);
    return row ?? null;
  } catch (err) {
    console.warn("[dacs:subagent] get failed:", err);
    return null;
  }
}

export type SubagentStatus = "active" | "paused" | "completed" | "failed" | "cancelled";

export async function setSubagentStatus(id: string, status: SubagentStatus) {
  if (!db) return null;
  try {
    const [row] = await db
      .update(dacsSubagents)
      .set({ status, updatedAt: new Date() })
      .where(eq(dacsSubagents.id, id))
      .returning({ id: dacsSubagents.id, status: dacsSubagents.status });
    return row ?? null;
  } catch (err) {
    console.warn("[dacs:subagent] setStatus failed:", err);
    return null;
  }
}

/**
 * Rows due for a tick: status=active AND next_run_at <= now AND not expired
 * AND not at max_ticks. Expired/maxed rows are auto-completed in a separate
 * pass so they don't fire one extra tick before recordTick() catches them.
 */
export async function dueSubagents(now: Date = new Date(), limit = 50) {
  if (!db) return [];
  try {
    const rows = await db
      .select()
      .from(dacsSubagents)
      .where(and(eq(dacsSubagents.status, "active"), lte(dacsSubagents.nextRunAt, now)))
      .limit(limit);
    // Filter expired / maxed in app-code so we can also auto-complete them
    // in a single follow-up update (avoids a second SQL roundtrip per row).
    const dueIds: string[] = [];
    const completeIds: string[] = [];
    for (const r of rows) {
      const expired = r.expiresAt != null && r.expiresAt <= now;
      const maxed = r.maxTicks != null && r.tickCount >= r.maxTicks;
      if (expired || maxed) completeIds.push(r.id);
      else dueIds.push(r.id);
    }
    if (completeIds.length > 0) {
      // Best-effort terminal sweep — single update for all expired/maxed.
      try {
        for (const id of completeIds) {
          await db
            .update(dacsSubagents)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(dacsSubagents.id, id));
        }
      } catch (err) {
        console.warn("[dacs:subagent] terminal sweep failed:", err);
      }
    }
    return rows.filter((r) => dueIds.includes(r.id));
  } catch (err) {
    console.warn("[dacs:subagent] due query failed:", err);
    return [];
  }
}

export interface RecordTickInput {
  id: string;
  status: "ok" | "failed" | "skipped";
  note?: string | null;
  /** Pass when the sub-agent has run its course (max_ticks reached, etc.). */
  completed?: boolean;
}

export async function recordTick(input: RecordTickInput) {
  if (!db) return null;
  try {
    const existing = await getSubagent(input.id);
    if (!existing) return null;
    const nextTickCount = existing.tickCount + (input.status === "ok" ? 1 : 0);
    const reachedMax =
      existing.maxTicks != null && nextTickCount >= existing.maxTicks;
    const expired = existing.expiresAt != null && existing.expiresAt <= new Date();
    const newStatus: SubagentStatus = input.completed || reachedMax || expired
      ? "completed"
      : input.status === "failed"
        ? "active" // retry next tick
        : "active";
    const [row] = await db
      .update(dacsSubagents)
      .set({
        tickCount: nextTickCount,
        lastTickAt: new Date(),
        lastTickStatus: input.status,
        lastTickNote: input.note ?? null,
        // Honor cron when present, else fall back to interval.
        nextRunAt: computeNextRun(existing.intervalSeconds, existing.cronExpr),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(dacsSubagents.id, input.id))
      .returning({ id: dacsSubagents.id, status: dacsSubagents.status });
    return row ?? null;
  } catch (err) {
    console.warn("[dacs:subagent] recordTick failed:", err);
    return null;
  }
}

/**
 * Persist trigger evaluation output AND advance next_run_at without bumping
 * tick_count. Used by the runtime when a conditional trigger said "not yet".
 */
export async function recordTriggerEval(
  id: string,
  meta: Record<string, unknown>,
): Promise<void> {
  if (!db) return;
  try {
    const existing = await getSubagent(id);
    if (!existing) return;
    await db
      .update(dacsSubagents)
      .set({
        triggerMeta: meta,
        lastEvalAt: new Date(),
        nextRunAt: computeNextRun(existing.intervalSeconds, existing.cronExpr),
        updatedAt: new Date(),
      })
      .where(eq(dacsSubagents.id, id));
  } catch (err) {
    console.warn("[dacs:subagent] recordTriggerEval failed:", err);
  }
}
