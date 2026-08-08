/**
 * Phase 8 — Observability traces API.
 *
 * Aggregates `agent_tool_metrics` for the admin "/app/admin/traces" page.
 * Returns: per-capability latency p50/p95, error rate, total runs, recent
 * failures, and a 30-row tail of raw events.
 *
 * Admin-gated using the same JWT scheme as /api/admin/metrics.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agentToolMetrics, users, agentCircuitBreaker } from "@/db/schema";
import { sql, desc, eq } from "drizzle-orm";
import { jwtVerify } from "jose";

export const dynamic = "force-dynamic";

function getAdminToken(req: NextRequest) {
  const h = req.headers.get("Authorization");
  if (h?.startsWith("Bearer ")) return h.substring(7);
  return (
    req.cookies.get("keystone-siws-session")?.value ||
    req.cookies.get("better-auth.session_token")?.value ||
    req.cookies.get("__Secure-neon-auth.session_token")?.value ||
    req.cookies.get("neon-auth.session_token")?.value ||
    null
  );
}

export async function GET(req: NextRequest) {
  if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });
  const dbx = db;
  const token = getAdminToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET || "");
    if (!secret.length) return NextResponse.json({ error: "Auth not configured" }, { status: 503 });
    const { payload } = await jwtVerify(token, secret);
    const wallet = (payload as any).wallet || (payload as any).sub;
    const u = await dbx.query.users.findFirst({ where: (t, { eq }) => eq(t.walletAddress, wallet as string) });
    if (!u || u.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [perCap, recent, breakers, totals] = await Promise.all([
    dbx
      .select({
        capabilityId: agentToolMetrics.capabilityId,
        runs: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) filter (where outcome = 'error')::int`,
        denied: sql<number>`count(*) filter (where outcome = 'denied')::int`,
        avgMs: sql<number>`coalesce(avg(latency_ms),0)::int`,
        p95Ms: sql<number>`coalesce(percentile_disc(0.95) within group (order by latency_ms), 0)::int`,
        costUsd: sql<number>`coalesce(sum(cost_usd_est),0)::float`,
      })
      .from(agentToolMetrics)
      .where(sql`created_at >= ${since}`)
      .groupBy(agentToolMetrics.capabilityId)
      .orderBy(sql`count(*) desc`)
      .limit(50),
    dbx
      .select()
      .from(agentToolMetrics)
      .orderBy(desc(agentToolMetrics.createdAt))
      .limit(40),
    dbx.select().from(agentCircuitBreaker).orderBy(desc(agentCircuitBreaker.updatedAt)).limit(20),
    dbx
      .select({
        runs: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) filter (where outcome = 'error')::int`,
        cost: sql<number>`coalesce(sum(cost_usd_est),0)::float`,
        users: sql<number>`count(distinct user_id)::int`,
      })
      .from(agentToolMetrics)
      .where(sql`created_at >= ${since}`),
  ]);

  return NextResponse.json({
    since: since.toISOString(),
    totals: totals[0] ?? { runs: 0, errors: 0, cost: 0, users: 0 },
    capabilities: perCap,
    recent,
    breakers,
  });
}
