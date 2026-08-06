import { NextRequest, NextResponse } from "next/server";
import { checkPublicRateLimit } from "@/lib/public-rate-limit";
import { isValidSolanaAddress } from "@/lib/atlas-utils";
export const runtime = "edge";

export const dynamic = "force-dynamic";

interface Collection {
  groupId: string;
  name: string;
  count: number;
  thumbnails: string[];
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const rl = checkPublicRateLimit(req, { bucket: "nfts", max: 30 });
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return NextResponse.json({ collections: [] });

  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "nft",
        method: "getAssetsByOwner",
        params: { ownerAddress: address, page: 1, limit: 200, displayOptions: { showFungible: false, showCollectionMetadata: true } },
      }),
      cache: "no-store",
    });
    if (!r.ok) return NextResponse.json({ collections: [] });
    const j = await r.json();
    const items: any[] = j?.result?.items ?? [];
    const byGroup = new Map<string, Collection>();
    for (const it of items) {
      if (it?.interface === "FungibleToken" || it?.interface === "FungibleAsset") continue;
      const grouping = (it?.grouping ?? []).find((g: any) => g?.group_key === "collection");
      const groupId = grouping?.group_value || "ungrouped";
      const name = grouping?.collection_metadata?.name || it?.content?.metadata?.name || "Untitled";
      const thumb = it?.content?.links?.image || it?.content?.files?.[0]?.cdn_uri || it?.content?.files?.[0]?.uri;
      const cur: Collection = byGroup.get(groupId) ?? { groupId, name, count: 0, thumbnails: [] };
      cur.count += 1;
      if (thumb && cur.thumbnails.length < 4) cur.thumbnails.push(thumb as string);
      byGroup.set(groupId, cur);
    }
    const collections = Array.from(byGroup.values()).sort((a, b) => b.count - a.count).slice(0, 12);
    return NextResponse.json({ collections }, { headers: { "Cache-Control": "public, max-age=120" } });
  } catch {
    return NextResponse.json({ collections: [] });
  }
}
