/**
 * DACS shadow-mode parity audit by command route.
 *
 * Aggregates `command_diff_log` rows grouped by route key (legacy decision
 * kind, falling back to dacs decision kind) and returns parity counts +
 * drift rate per route, plus a sample of the most recent drift rows for each.
 *
 * Read-only. Returns 503 if the database isn't configured.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { commandDiffLog } from "@/db/schema";
import { desc, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteBucket {
  route: string;
  total: number;
  match: number;
  drift: number;
  legacy_only: number;
  dacs_only: number;
  error: number;
  pending: number;
  driftRate: number;
  avgLegacyLatencyMs: number | null;
  avgDacsLatencyMs: number | null;
  sampleDrifts: Array<{
    commandId: string;
    rawText: string;
    legacyDecisionKind: string | null;
    dacsDecisionKind: string | null;
    parityNotes: string | null;
    createdAt: string;
  }>;
}

export async function GET(_req: NextRequest) {
  if (!db) return NextResponse.json({ error: "db_not_configured" }, { status: 503 });
  const dbx = db;

  try {
    const rows = await dbx
      .select()
      .from(commandDiffLog)
      .orderBy(desc(commandDiffLog.createdAt))
      .limit(2000);

    const byRoute = new Map<string, RouteBucket>();
    for (const r of rows) {
      const route = (r.legacyDecisionKind ?? r.dacsDecisionKind ?? "unknown") as string;
      let b = byRoute.get(route);
      if (!b) {
        b = {
          route,
          total: 0,
          match: 0,
          drift: 0,
          legacy_only: 0,
          dacs_only: 0,
          error: 0,
          pending: 0,
          driftRate: 0,
          avgLegacyLatencyMs: null,
          avgDacsLatencyMs: null,
          sampleDrifts: [],
        };
        byRoute.set(route, b);
      }
      b.total += 1;
      const p = r.parity ?? "pending";
      if (p in b) (b as any)[p] += 1;
      else b.pending += 1;
      if (p === "drift" && b.sampleDrifts.length < 5) {
        b.sampleDrifts.push({
          commandId: r.commandId,
          rawText: r.rawText,
          legacyDecisionKind: r.legacyDecisionKind,
          dacsDecisionKind: r.dacsDecisionKind,
          parityNotes: r.parityNotes,
          createdAt: (r.createdAt as Date).toISOString(),
        });
      }
    }

    // Latency averages (separate pass to avoid nulls polluting Map init)
    for (const r of rows) {
      const route = (r.legacyDecisionKind ?? r.dacsDecisionKind ?? "unknown") as string;
      const b = byRoute.get(route);
      if (!b) continue;
      if (r.legacyLatencyMs != null) {
        b.avgLegacyLatencyMs = ((b.avgLegacyLatencyMs ?? 0) * 0.7) + r.legacyLatencyMs * 0.3;
      }
      if (r.dacsLatencyMs != null) {
        b.avgDacsLatencyMs = ((b.avgDacsLatencyMs ?? 0) * 0.7) + r.dacsLatencyMs * 0.3;
      }
    }

    const buckets = Array.from(byRoute.values()).map((b) => ({
      ...b,
      driftRate: b.total > 0 ? b.drift / b.total : 0,
      avgLegacyLatencyMs: b.avgLegacyLatencyMs != null ? Math.round(b.avgLegacyLatencyMs) : null,
      avgDacsLatencyMs: b.avgDacsLatencyMs != null ? Math.round(b.avgDacsLatencyMs) : null,
    }));
    buckets.sort((a, b) => b.driftRate - a.driftRate || b.total - a.total);

    const totals = await dbx.execute<{ parity: string | null; n: number }>(
      sql`SELECT parity, COUNT(*)::int AS n FROM command_diff_log GROUP BY parity`,
    );

    return NextResponse.json({
      ok: true,
      sampledRows: rows.length,
      buckets,
      totals: totals.rows ?? totals,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
