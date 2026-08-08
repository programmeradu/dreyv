import { NextRequest, NextResponse } from "next/server";
import { getEnhancedTransactions } from "@/lib/explorer/helius-tx";
import { lookupSolanaLabel, shortAddress } from "@/lib/explorer/labels";
import { checkPublicRateLimit } from "@/lib/public-rate-limit";
import { isValidSolanaAddress } from "@/lib/atlas-utils";

export const dynamic = "force-dynamic";

interface Row {
  address: string;
  label: string;
  category: string | null;
  logoSlug?: string;
  count: number;
  solDelta: number;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const rl = checkPublicRateLimit(req, { bucket: "counterparties", max: 30 });
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const txs = await getEnhancedTransactions(address, 200);
  const inMap = new Map<string, Row>();
  const outMap = new Map<string, Row>();

  const touch = (other: string, isIn: boolean, sol: number) => {
    if (!other || other === address) return;
    const target = isIn ? inMap : outMap;
    const lbl = lookupSolanaLabel(other);
    const row = target.get(other) ?? {
      address: other,
      label: lbl?.label ?? shortAddress(other),
      category: lbl?.category ?? null,
      logoSlug: lbl?.logoSlug,
      count: 0,
      solDelta: 0,
    };
    row.count += 1;
    row.solDelta += sol;
    target.set(other, row);
  };

  for (const t of txs) {
    for (const nt of t.nativeTransfers ?? []) {
      const isIn = nt.toUserAccount === address;
      const isOut = nt.fromUserAccount === address;
      if (!isIn && !isOut) continue;
      const other = (isIn ? nt.fromUserAccount : nt.toUserAccount) ?? "";
      touch(other, isIn, (nt.amount ?? 0) / 1e9);
    }
    for (const tt of t.tokenTransfers ?? []) {
      const isIn = tt.toUserAccount === address;
      const isOut = tt.fromUserAccount === address;
      if (!isIn && !isOut) continue;
      const other = (isIn ? tt.fromUserAccount : tt.toUserAccount) ?? "";
      // No reliable USD here; contribute 0 to solDelta but still count interactions
      touch(other, isIn, 0);
    }
  }

  const top = (m: Map<string, Row>) =>
    Array.from(m.values())
      .sort((a, b) => (Math.abs(b.solDelta) - Math.abs(a.solDelta)) || (b.count - a.count))
      .slice(0, 10);

  return NextResponse.json(
    { inbound: top(inMap), outbound: top(outMap) },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
