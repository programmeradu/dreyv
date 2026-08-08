export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";
import { findSiblings } from "@/lib/explorer/siblings";
import { checkPublicRateLimit } from "@/lib/public-rate-limit";
import { isValidSolanaAddress } from "@/lib/atlas-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const rl = checkPublicRateLimit(req, { bucket: "siblings", max: 15 });
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const siblings = await findSiblings(address);
  return NextResponse.json({ siblings }, { headers: { "Cache-Control": "public, max-age=120" } });
}
