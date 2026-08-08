export const runtime = "edge";
/**
 * DACS Phase 5.3 — Admin handoffs audit.
 *
 * Aggregates `dacs_handoffs` rows per specialist with status mix, duration
 * percentiles, and a sample of recent rejections / deferrals. Mirrors the
 * shape of `/api/admin/dacs-parity-audit` so the admin dashboard can reuse
 * the same UI patterns.
 *
 * Read-only. Returns 503 if DB isn't configured.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { dacsHandoffs } from "@/db/schema";
import { desc } from "drizzle-orm";
import { jwtVerify } from "jose";

export const dynamic = "force-dynamic";

async function requireAdmin(req: NextRequest) {
  if (!db) return { ok: false as const, status: 503, error: "db_not_configured" };
  const authHeader = req.headers.get("Authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  const token =
    bearer ||
    req.cookies.get("keystone-siws-session")?.value ||
    req.cookies.get("better-auth.session_token")?.value ||
    req.cookies.get("__Secure-neon-auth.session_token")?.value ||
    req.cookies.get("neon-auth.session_token")?.value ||
    null;
  if (!token) return { ok: false as const, status: 401, error: "unauthorized" };
  try {
    const jwtSecret = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) return { ok: false as const, status: 503, error: "auth_not_configured" };
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
    const wallet = (payload as any).wallet || payload.sub;
    if (!wallet) return { ok: false as const, status: 401, error: "unauthorized" };
    const liveUser = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.walletAddress, wallet as string),
    });
    if (!liveUser || liveUser.role !== "admin") {
      return { ok: false as const, status: 403, error: "forbidden" };
    }
  } catch {
    return { ok: false as const, status: 401, error: "invalid_token" };
  }
  return { ok: true as const };
}

interface SpecialistBucket {
  specialist: string;
  total: number;
  completed: number;
  accepted: number;
  deferred: number;
  rejected: number;
  failureRate: number;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  intentKinds: Record<string, number>;
  recentIssues: Array<{
    id: string;
    commandId: string;
    status: string;
    summary: string;
    intentKind: string;
    durationMs: number | null;
    createdAt: string;
  }>;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  if (!db) {
    return NextResponse.json({ error: "db_not_configured" }, { status: 503 });
  }
  const dbx = db;

  try {
    const rows = await dbx
      .select()
      .from(dacsHandoffs)
      .orderBy(desc(dacsHandoffs.createdAt))
      .limit(2000);

    const bySpecialist = new Map<string, SpecialistBucket>();
    const durations = new Map<string, number[]>();

    for (const r of rows) {
      let b = bySpecialist.get(r.specialist);
      if (!b) {
        b = {
          specialist: r.specialist,
          total: 0,
          completed: 0,
          accepted: 0,
          deferred: 0,
          rejected: 0,
          failureRate: 0,
          p50DurationMs: null,
          p95DurationMs: null,
          intentKinds: {},
          recentIssues: [],
        };
        bySpecialist.set(r.specialist, b);
        durations.set(r.specialist, []);
      }
      b.total += 1;
      const status = r.status as keyof Pick<
        SpecialistBucket,
        "completed" | "accepted" | "deferred" | "rejected"
      >;
      if (status in b && typeof b[status] === "number") {
        (b[status] as number) += 1;
      }
      b.intentKinds[r.intentKind] = (b.intentKinds[r.intentKind] ?? 0) + 1;
      if (typeof r.durationMs === "number") {
        durations.get(r.specialist)!.push(r.durationMs);
      }
      if ((r.status === "rejected" || r.status === "deferred") && b.recentIssues.length < 5) {
        b.recentIssues.push({
          id: r.id,
          commandId: r.commandId,
          status: r.status,
          summary: r.summary,
          intentKind: r.intentKind,
          durationMs: r.durationMs ?? null,
          createdAt: (r.createdAt as Date).toISOString(),
        });
      }
    }

    const buckets = Array.from(bySpecialist.values()).map((b) => {
      const sorted = (durations.get(b.specialist) ?? []).sort((a, c) => a - c);
      return {
        ...b,
        failureRate: b.total > 0 ? b.rejected / b.total : 0,
        p50DurationMs: percentile(sorted, 50),
        p95DurationMs: percentile(sorted, 95),
      };
    });
    buckets.sort((a, b) => b.failureRate - a.failureRate || b.total - a.total);

    const totals = {
      total: rows.length,
      completed: rows.filter((r) => r.status === "completed").length,
      accepted: rows.filter((r) => r.status === "accepted").length,
      deferred: rows.filter((r) => r.status === "deferred").length,
      rejected: rows.filter((r) => r.status === "rejected").length,
    };

    return NextResponse.json({
      ok: true,
      sampledRows: rows.length,
      totals,
      buckets,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
