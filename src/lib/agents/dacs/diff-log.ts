/**
 * DACS Phase 1 — diff log writer.
 *
 * Single source of truth for command_diff_log row updates. Both the legacy
 * pipeline (`/api/command/route.ts`) and the DACS pipeline (`command-router`)
 * write into the same row keyed by `commandId`, so the diff harness can
 * compare side-by-side without race conditions.
 *
 * All writes are best-effort: a failed log write must NEVER break the user's
 * actual command flow. We swallow + log errors instead of throwing.
 */

import { db } from "@/db";
import { commandDiffLog } from "@/db/schema";
import { sql } from "drizzle-orm";
import type { Intent, Plan, RouteDecision } from "./types";

interface SeedInput {
  commandId: string;
  walletAddress: string | null;
  rawText: string;
  promptMode: "auto" | "build" | "execute";
}

export async function seedDiffRow(input: SeedInput): Promise<void> {
  if (!db) return;
  try {
    await db
      .insert(commandDiffLog)
      .values({
        commandId: input.commandId,
        walletAddress: input.walletAddress,
        rawText: input.rawText,
        promptMode: input.promptMode,
      })
      .onConflictDoNothing({ target: commandDiffLog.commandId });
  } catch (e) {
    console.warn("[diff-log] seed failed", (e as Error).message);
  }
}

interface LegacySnapshot {
  commandId: string;
  summary?: string | null;
  toolCalls?: unknown;
  decisionKind?: string | null;
  latencyMs?: number;
}

export async function recordLegacy(snap: LegacySnapshot): Promise<void> {
  if (!db) return;
  try {
    await db
      .update(commandDiffLog)
      .set({
        legacySummary: snap.summary ?? null,
        legacyToolCalls: (snap.toolCalls as any) ?? null,
        legacyDecisionKind: snap.decisionKind ?? null,
        legacyLatencyMs: snap.latencyMs ?? null,
        updatedAt: new Date(),
      })
      .where(sql`${commandDiffLog.commandId} = ${snap.commandId}`);
  } catch (e) {
    console.warn("[diff-log] legacy update failed", (e as Error).message);
  }
}

interface DacsSnapshot {
  commandId: string;
  intent?: Intent;
  plan?: Plan;
  decision?: RouteDecision;
  latencyMs?: number;
}

export async function recordDacs(snap: DacsSnapshot): Promise<void> {
  if (!db) return;
  try {
    await db
      .update(commandDiffLog)
      .set({
        dacsIntent: (snap.intent as any) ?? null,
        dacsPlan: (snap.plan as any) ?? null,
        dacsDecisionKind: snap.decision?.kind ?? null,
        dacsDecisionReason: snap.decision?.reason ?? null,
        dacsLatencyMs: snap.latencyMs ?? null,
        updatedAt: new Date(),
      })
      .where(sql`${commandDiffLog.commandId} = ${snap.commandId}`);
  } catch (e) {
    console.warn("[diff-log] dacs update failed", (e as Error).message);
  }
}

/** Compute parity verdict between legacy + DACS snapshots already in the row. */
export async function computeParity(commandId: string): Promise<void> {
  if (!db) return;
  try {
    const rows = await db
      .select()
      .from(commandDiffLog)
      .where(sql`${commandDiffLog.commandId} = ${commandId}`)
      .limit(1);
    const row = rows[0];
    if (!row) return;

    let parity: "match" | "drift" | "dacs_only" | "legacy_only" | "error" = "error";
    let notes = "";
    const haveLegacy = !!row.legacyDecisionKind;
    const haveDacs = !!row.dacsDecisionKind;

    if (haveLegacy && !haveDacs) parity = "legacy_only";
    else if (!haveLegacy && haveDacs) parity = "dacs_only";
    else if (haveLegacy && haveDacs) {
      parity = row.legacyDecisionKind === row.dacsDecisionKind ? "match" : "drift";
      if (parity === "drift") {
        notes = `legacy=${row.legacyDecisionKind} vs dacs=${row.dacsDecisionKind}`;
      }
    }

    await db
      .update(commandDiffLog)
      .set({ parity, parityNotes: notes || null, updatedAt: new Date() })
      .where(sql`${commandDiffLog.commandId} = ${commandId}`);
  } catch (e) {
    console.warn("[diff-log] parity compute failed", (e as Error).message);
  }
}
