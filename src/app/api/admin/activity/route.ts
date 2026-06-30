/**
 * GET /api/admin/activity — unified activity feed for the admin Activity page.
 *
 * Returns recent signups, agent payments, capability actions/usage, audit log
 * entries, and recent errors. Admin-gated using the same JWT scheme as
 * /api/admin/metrics and /api/admin/traces.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  users,
  agentPayments,
  agentToolMetrics,
  publicApiKeyUsage,
  publicApiAuditLog,
  agentBalances,
  agentBalanceLedger,
} from "@/db/schema";
import { sql, desc } from "drizzle-orm";
import { jwtVerify } from "jose";

export const runtime = "nodejs";
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
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET || "",
    );
    if (!secret.length)
      return NextResponse.json({ error: "Auth not configured" }, { status: 503 });
    const { payload } = await jwtVerify(token, secret);
    const wallet = (payload as any).wallet || (payload as any).sub;
    const u = await dbx.query.users.findFirst({
      where: (t, { eq }) => eq(t.walletAddress, wallet as string),
    });
    if (!u || u.role !== "admin")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    recentSignups,
    signupTotals,
    recentPayments,
    paymentTotals,
    recentUsage,
    usageTotals,
    recentAudit,
    recentErrors,
    balanceTotals,
    recentLedger,
    topUsers,
  ] = await Promise.all([
    dbx
      .select({
        id: users.id,
        email: users.email,
        wallet: users.walletAddress,
        tier: users.tier,
        onboarded: users.onboardingCompleted,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(25),
    dbx
      .select({
        total: sql<number>`count(*)::int`,
        last24h: sql<number>`(count(*) filter (where created_at >= ${oneDayAgo}))::int`,
        last7d: sql<number>`(count(*) filter (where created_at >= ${sevenDaysAgo}))::int`,
      })
      .from(users),
    dbx
      .select()
      .from(agentPayments)
      .orderBy(desc(agentPayments.createdAt))
      .limit(25),
    dbx
      .select({
        total: sql<number>`count(*)::int`,
        paid: sql<number>`(count(*) filter (where status = 'paid'))::int`,
        pending: sql<number>`(count(*) filter (where status = 'pending'))::int`,
        failed: sql<number>`(count(*) filter (where status in ('failed','expired')))::int`,
        gross24h: sql<number>`coalesce(sum(amount_usd) filter (where status = 'paid' and created_at >= ${oneDayAgo}), 0)::float`,
        gross7d: sql<number>`coalesce(sum(amount_usd) filter (where status = 'paid' and created_at >= ${sevenDaysAgo}), 0)::float`,
        grossAll: sql<number>`coalesce(sum(amount_usd) filter (where status = 'paid'), 0)::float`,
      })
      .from(agentPayments),
    dbx
      .select()
      .from(publicApiKeyUsage)
      .orderBy(desc(publicApiKeyUsage.ts))
      .limit(30),
    dbx
      .select({
        calls24h: sql<number>`(count(*) filter (where ts >= ${oneDayAgo}))::int`,
        errors24h: sql<number>`(count(*) filter (where ts >= ${oneDayAgo} and status <> 'ok'))::int`,
        credits24h: sql<number>`coalesce(sum(cost_credits) filter (where ts >= ${oneDayAgo}), 0)::float`,
        keys24h: sql<number>`(count(distinct key_id) filter (where ts >= ${oneDayAgo}))::int`,
      })
      .from(publicApiKeyUsage),
    dbx
      .select()
      .from(publicApiAuditLog)
      .orderBy(desc(publicApiAuditLog.ts))
      .limit(30),
    dbx
      .select()
      .from(agentToolMetrics)
      .where(sql`outcome <> 'ok'`)
      .orderBy(desc(agentToolMetrics.createdAt))
      .limit(25),
    dbx
      .select({
        wallets: sql<number>`count(*)::int`,
        funded: sql<number>`(count(*) filter (where balance_minor::numeric > 0))::int`,
        totalMinor: sql<string>`coalesce(sum(balance_minor::numeric), 0)::text`,
      })
      .from(agentBalances),
    dbx
      .select()
      .from(agentBalanceLedger)
      .orderBy(desc(agentBalanceLedger.createdAt))
      .limit(20),
    dbx
      .select({
        userId: publicApiKeyUsage.userId,
        calls: sql<number>`count(*)::int`,
        errors: sql<number>`(count(*) filter (where status <> 'ok'))::int`,
        credits: sql<number>`coalesce(sum(cost_credits), 0)::float`,
      })
      .from(publicApiKeyUsage)
      .where(sql`ts >= ${sevenDaysAgo}`)
      .groupBy(publicApiKeyUsage.userId)
      .orderBy(sql`count(*) desc`)
      .limit(15),
  ]);

  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
    signups: { totals: signupTotals[0], recent: recentSignups },
    payments: { totals: paymentTotals[0], recent: recentPayments },
    usage: { totals: usageTotals[0], recent: recentUsage, topUsers },
    audit: { recent: recentAudit },
    errors: { recent: recentErrors },
    balances: { totals: balanceTotals[0], recentLedger },
  });
}
