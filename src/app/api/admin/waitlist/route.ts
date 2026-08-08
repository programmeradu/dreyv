export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { waitlistEntries, users } from "@/db/schema";
import { checkDatabaseAvailability } from "@/lib/db-utils";
import { getAuthUser } from "@/lib/auth-utils";


async function isAdmin(userId: string): Promise<boolean> {
  if (!db) return false;
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.role === "admin";
}

export async function GET(request: NextRequest) {
  try {
    const dbCheck = checkDatabaseAvailability();
    if (dbCheck) return dbCheck;

    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(auth.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sp = request.nextUrl.searchParams;
    const status = sp.get("status");
    const orgType = sp.get("orgType");
    const search = sp.get("q")?.trim();
    const limit = Math.min(parseInt(sp.get("limit") || "50", 10) || 50, 200);
    const offset = Math.max(parseInt(sp.get("offset") || "0", 10) || 0, 0);

    const filters = [];
    if (status) filters.push(eq(waitlistEntries.status, status));
    if (orgType) filters.push(eq(waitlistEntries.orgType, orgType));
    if (search) {
      filters.push(
        or(
          ilike(waitlistEntries.email, `%${search}%`),
          ilike(waitlistEntries.organization, `%${search}%`),
          ilike(waitlistEntries.name, `%${search}%`),
        )!,
      );
    }
    const whereExpr = filters.length ? and(...filters) : undefined;

    const rows = await db!
      .select()
      .from(waitlistEntries)
      .where(whereExpr)
      .orderBy(desc(waitlistEntries.createdAt))
      .limit(limit)
      .offset(offset);

    // KPIs
    const kpiRows = await db!
      .select({
        status: waitlistEntries.status,
        count: sql<number>`count(*)::int`,
      })
      .from(waitlistEntries)
      .groupBy(waitlistEntries.status);

    const kpis: Record<string, number> = { pending: 0, invited: 0, onboarded: 0, rejected: 0, total: 0 };
    for (const r of kpiRows) {
      kpis[r.status as string] = r.count;
      kpis.total += r.count;
    }
    const conversion = kpis.invited > 0 ? Math.round((kpis.onboarded / kpis.invited) * 100) : 0;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [{ count: last7d }] = await db!
      .select({ count: sql<number>`count(*)::int` })
      .from(waitlistEntries)
      .where(sql`${waitlistEntries.createdAt} >= ${sevenDaysAgo}`);

    return NextResponse.json({
      ok: true,
      kpis: { ...kpis, conversion, last7d },
      rows,
      paging: { limit, offset, returned: rows.length },
    });
  } catch (err) {
    console.error("[admin/waitlist] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
