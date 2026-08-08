import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { protocolFees, users } from "@/db/schema";
import { jwtVerify } from "jose";

export const dynamic = "force-dynamic";

function getAdminToken(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.substring(7);
  return (
    req.cookies.get("keystone-siws-session")?.value ||
    req.cookies.get("better-auth.session_token")?.value ||
    req.cookies.get("__Secure-neon-auth.session_token")?.value ||
    req.cookies.get("neon-auth.session_token")?.value ||
    null
  );
}

const RANGES: Record<string, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export async function GET(req: NextRequest) {
  try {
    if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });
    const dbx = db;

    const token = getAdminToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const jwtSecret = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;
      if (!jwtSecret) return NextResponse.json({ error: "Auth not configured" }, { status: 503 });
      const secret = new TextEncoder().encode(jwtSecret);
      const result = await jwtVerify(token, secret);
      const wallet = (result.payload as any).wallet || (result.payload as any).sub;
      const liveUser = await dbx.query.users.findFirst({
        where: (u, { eq }) => eq(u.walletAddress, wallet as string),
      });
      if (!liveUser || liveUser.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Unauthorized: Invalid token" }, { status: 401 });
    }

    const url = new URL(req.url);
    const rangeKey = (url.searchParams.get("range") || "30d").toLowerCase();
    const days = RANGES[rangeKey] ?? 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [daily, payers, byOp, recent] = await Promise.all([
      // Daily fee + volume series
      dbx.execute(sql`
        SELECT
          to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
          COALESCE(SUM(fee_usd), 0)::float AS fees,
          COALESCE(SUM(estimated_value_usd), 0)::float AS volume,
          COUNT(*)::int AS tx
        FROM protocol_fees
        WHERE created_at >= ${since}
        GROUP BY 1
        ORDER BY 1 ASC
      `),
      // Top fee payers
      dbx.execute(sql`
        SELECT
          wallet_address,
          COALESCE(SUM(fee_usd), 0)::float AS fees,
          COALESCE(SUM(estimated_value_usd), 0)::float AS volume,
          COUNT(*)::int AS tx,
          MAX(created_at) AS last_at
        FROM protocol_fees
        WHERE created_at >= ${since}
        GROUP BY wallet_address
        ORDER BY fees DESC
        LIMIT 25
      `),
      // By operation
      dbx.execute(sql`
        SELECT
          COALESCE(operation, 'unknown') AS operation,
          COALESCE(SUM(fee_usd), 0)::float AS fees,
          COUNT(*)::int AS tx
        FROM protocol_fees
        WHERE created_at >= ${since}
        GROUP BY 1
        ORDER BY fees DESC
        LIMIT 12
      `),
      // Recent fees
      dbx.execute(sql`
        SELECT
          fee_signature, parent_signature, wallet_address, operation,
          fee_usd::float AS fee_usd, estimated_value_usd::float AS value_usd,
          source, created_at
        FROM protocol_fees
        WHERE created_at >= ${since}
        ORDER BY created_at DESC
        LIMIT 25
      `),
    ]);

    const rows = (r: any) => (Array.isArray(r) ? r : r?.rows ?? []);

    return NextResponse.json({
      range: rangeKey,
      days,
      since: since.toISOString(),
      daily: rows(daily),
      topPayers: rows(payers),
      byOperation: rows(byOp),
      recent: rows(recent),
      fetchedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("[/api/admin/protocol-fees] failed", e);
    return NextResponse.json({ error: e?.message ?? "server_error" }, { status: 500 });
  }
}
