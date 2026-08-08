export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";
import { getEnhancedTransactions } from "@/lib/explorer/helius-tx";
import { checkPublicRateLimit } from "@/lib/public-rate-limit";
import { isValidSolanaAddress } from "@/lib/atlas-utils";

export const dynamic = "force-dynamic";

interface Item {
  signature: string;
  timestamp: number;
  type: string;
  source?: string;
  description: string;
  protocol?: string;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const rl = checkPublicRateLimit(req, { bucket: "activity", max: 30 });
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const txs = await getEnhancedTransactions(address, 60);
  const items: Item[] = txs.slice(0, 40).map((t) => ({
    signature: t.signature,
    timestamp: t.timestamp,
    type: t.type ?? "UNKNOWN",
    source: t.source,
    description: t.description || `${t.type ?? "Activity"}${t.source ? ` on ${t.source.toLowerCase()}` : ""}`,
    protocol: t.source?.toLowerCase(),
  }));
  return NextResponse.json({ items }, { headers: { "Cache-Control": "public, max-age=30" } });
}
