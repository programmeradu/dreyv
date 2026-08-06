/**
 * GET /api/agents/balance/ledger — paginated balance ledger history.
 *
 * Auth: Bearer (dk_live_… or OAuth JWT).
 *
 * Query params:
 *   limit   — max rows (default 50, max 200)
 *   cursor  — ISO timestamp; returns rows strictly older than this (keyset pagination)
 *   kind    — 'credit' | 'debit' | 'all' (default 'all')
 *   reason  — exact match on reason (e.g. 'topup_stripe', 'topup_paystack',
 *             'topup_x402', 'topup_manual', 'charge:<sku>', 'refund')
 *
 * Returns:
 *   {
 *     entries: [{ id, delta_minor, delta, balance_after_minor, balance_after,
 *                 kind, reason, ref, created_at }],
 *     next_cursor: string | null,
 *     currency: 'USDC'
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { minorToUsd } from "@/lib/agent/balance";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function GET(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const sp = req.nextUrl.searchParams;

  const limitRaw = Number.parseInt(sp.get("limit") ?? "", 10);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT),
  );

  const cursorRaw = sp.get("cursor");
  let cursor: Date | null = null;
  if (cursorRaw) {
    const d = new Date(cursorRaw);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "invalid_cursor", hint: "ISO 8601 timestamp" }, { status: 400 });
    }
    cursor = d;
  }

  const kind = (sp.get("kind") ?? "all").toLowerCase();
  if (!["all", "credit", "debit"].includes(kind)) {
    return NextResponse.json({ error: "invalid_kind", allowed: ["all", "credit", "debit"] }, { status: 400 });
  }

  const reason = sp.get("reason");

  const rows = await db.execute(sql`
    SELECT id::text,
           delta_minor::text,
           balance_after::text,
           reason,
           ref,
           created_at
      FROM agent_balance_ledger
     WHERE user_id = ${key.userId}::uuid
       ${cursor ? sql`AND created_at < ${cursor.toISOString()}::timestamptz` : sql``}
       ${kind === "credit" ? sql`AND delta_minor > 0` : sql``}
       ${kind === "debit" ? sql`AND delta_minor < 0` : sql``}
       ${reason ? sql`AND reason = ${reason}` : sql``}
     ORDER BY created_at DESC
     LIMIT ${limit + 1}
  `);

  const raw = (rows as unknown as {
    rows: Array<{
      id: string;
      delta_minor: string;
      balance_after: string;
      reason: string;
      ref: string | null;
      created_at: Date;
    }>;
  }).rows;

  const page = raw.slice(0, limit);
  const hasMore = raw.length > limit;
  const next_cursor = hasMore ? new Date(page[page.length - 1].created_at).toISOString() : null;

  const entries = page.map((r) => {
    const delta = BigInt(r.delta_minor);
    const absDelta = delta < BigInt(0) ? -delta : delta;
    return {
      id: r.id,
      delta_minor: r.delta_minor,
      delta: (delta < BigInt(0) ? "-" : "") + minorToUsd(absDelta),
      balance_after_minor: r.balance_after,
      balance_after: minorToUsd(BigInt(r.balance_after)),
      kind: delta >= BigInt(0) ? "credit" : "debit",
      reason: r.reason,
      ref: r.ref,
      created_at: new Date(r.created_at).toISOString(),
    };
  });

  return NextResponse.json({
    entries,
    next_cursor,
    currency: "USDC",
    count: entries.length,
    limit,
    filters: { kind, reason: reason ?? null },
  });
}
