/**
 * /api/treasury/exports/events.csv?wallet=…&range=30d
 *
 * One-click CSV export of every treasury event in the window.
 * Uses the same shared csv builder as agent artifacts so output is
 * deterministic and spreadsheet-friendly.
 */
import { db } from "@/db";
import { treasuryEvents } from "@/db/schema";
import { and, eq, gte, desc } from "drizzle-orm";
import { buildCsv } from "@/lib/agents/artifacts/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGE_MS: Record<string, number | null> = {
  "7d": 7 * 86400_000,
  "30d": 30 * 86400_000,
  "90d": 90 * 86400_000,
  all: null,
};

export async function GET(req: Request) {
  if (!db) return new Response("no_db", { status: 500 });
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const range = url.searchParams.get("range") ?? "30d";
  if (!wallet) return new Response("wallet required", { status: 400 });

  const window = RANGE_MS[range] ?? RANGE_MS["30d"]!;
  const since = window ? new Date(Date.now() - window) : new Date(0);

  const rows = await db
    .select()
    .from(treasuryEvents)
    .where(
      and(
        eq(treasuryEvents.walletAddress, wallet),
        gte(treasuryEvents.occurredAt, since),
      ),
    )
    .orderBy(desc(treasuryEvents.occurredAt))
    .limit(5000);

  const flat = rows.map((r: any) => ({
    occurred_at: new Date(r.occurredAt).toISOString(),
    kind: r.kind,
    category: r.category ?? "",
    amount_usd: r.amountUsd,
    token: r.tokenSymbol ?? "",
    counterparty: r.counterparty ?? "",
    signature: r.signature ?? "",
    source: r.source ?? "",
  }));

  const buf = buildCsv({
    rows: flat,
    columns: [
      "occurred_at",
      "kind",
      "category",
      "amount_usd",
      "token",
      "counterparty",
      "signature",
      "source",
    ],
    preamble: [
      `Dreyv treasury events`,
      `Wallet: ${wallet}`,
      `Range: ${range}`,
      `Generated: ${new Date().toISOString()}`,
      `Rows: ${flat.length}`,
    ],
  });

  return new Response(buf, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dreyv-treasury-${range}-${wallet.slice(0, 8)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
