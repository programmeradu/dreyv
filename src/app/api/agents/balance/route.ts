/**
 * GET /api/agents/balance — read the agent's prepaid USDC balance.
 *
 * Auth: Bearer (dk_live_… or OAuth JWT).
 *
 * Returns:
 *   { balance_minor, balance, currency, updated_at, topup_url, ledger? }
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { getAgentBalance, minorToUsd } from "@/lib/agent/balance";
import { getSiteOrigin } from "@/lib/seo/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const balance = await getAgentBalance(key.userId);
  const origin = getSiteOrigin();

  const includeLedger = req.nextUrl.searchParams.get("ledger") === "1";
  let ledger: Array<{ delta_minor: string; balance_after: string; reason: string; ref: string | null; created_at: string }> = [];
  if (includeLedger) {
    const rows = await db.execute(sql`
      SELECT delta_minor::text, balance_after::text, reason, ref, created_at
        FROM agent_balance_ledger
       WHERE user_id = ${key.userId}::uuid
       ORDER BY created_at DESC
       LIMIT 50
    `);
    ledger = (rows as unknown as { rows: typeof ledger }).rows;
  }

  return NextResponse.json({
    balance_minor: balance.balance_minor.toString(),
    balance: minorToUsd(balance.balance_minor),
    currency: balance.currency,
    updated_at: balance.updated_at.toISOString(),
    topup_url: `${origin}/api/agents/balance/topup`,
    ...(includeLedger ? { ledger } : {}),
  });
}
