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

export interface SpawnSubagentInput {
  walletAddress: string | null;
  parentCommandId: string;
  title: string;
  rawText: string;
  intent: Intent;
  planTemplate: Plan;
  intervalSeconds?: number;
  maxTicks?: number | null;
  expiresAt?: Date | null;
}

export async function spawnSubagent(input: SpawnSubagentInput): Promise<string | null> {
  if (!db) return null;
  try {
    const interval = Math.max(60, input.intervalSeconds ?? 86_400);
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
        nextRunAt: new Date(Date.now() + interval * 1000),
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

/** Rows due for a tick: status=active AND next_run_at <= now. */
export async function dueSubagents(now: Date = new Date(), limit = 50) {
  if (!db) return [];
  try {
    return await db
      .select()
      .from(dacsSubagents)
      .where(and(eq(dacsSubagents.status, "active"), lte(dacsSubagents.nextRunAt, now)))
      .limit(limit);
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
        nextRunAt: new Date(Date.now() + existing.intervalSeconds * 1000),
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
