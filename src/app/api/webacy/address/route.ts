import { NextRequest, NextResponse } from "next/server";
import { scoreAddresses } from "@/lib/webacy/service";
import { publicRateLimitOrResponse } from "@/lib/public-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = publicRateLimitOrResponse(req, { bucket: "webacy-address", max: 30, windowMs: 60_000 });
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const addresses: string[] = Array.isArray(body?.addresses) ? body.addresses.filter((a: unknown) => typeof a === "string") : [];
  const chain: string = typeof body?.chain === "string" ? body.chain : "sol";

  if (addresses.length === 0) {
    return NextResponse.json({ error: "addresses required" }, { status: 400 });
  }
  if (addresses.length > 50) {
    return NextResponse.json({ error: "max 50 addresses per call" }, { status: 400 });
  }

  const scores = await scoreAddresses(addresses, chain);
  return NextResponse.json({
    chain,
    scores: Object.fromEntries(scores),
  });
}
