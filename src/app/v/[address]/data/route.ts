/**
 * /v/[address]/data — JSON mirror of the feature pack.
 *
 * Stable, machine-readable surface for LLM crawlers, third-party agents,
 * and the public llms.txt entry.
 */
import { NextRequest, NextResponse } from "next/server";
import { buildFeaturePack } from "@/lib/explorer/feature-pack";
import { isValidSolanaAddress } from "@/lib/atlas-utils";
import { detectAddressKind } from "@/lib/explorer/chain";

export const dynamic = "force-dynamic";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
    const { address } = await params;
    const kind = detectAddressKind(address);
    if (kind === "invalid") return NextResponse.json({ error: "invalid address" }, { status: 400 });
    if (kind !== "solana" || !isValidSolanaAddress(address)) {
        return NextResponse.json({ address, chain: kind, note: "Only Solana feature packs are available via this endpoint right now." });
    }
    const pack = await buildFeaturePack(address);
    return NextResponse.json(pack, { headers: { "Cache-Control": "public, max-age=60" } });
}
