export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";
import { scoreToken } from "@/lib/webacy/service";
import { publicRateLimitOrResponse } from "@/lib/public-rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = publicRateLimitOrResponse(req, { bucket: "webacy-token", max: 30, windowMs: 60_000 });
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const mint = typeof body?.mint === "string" ? body.mint : "";
  const chain = typeof body?.chain === "string" ? body.chain : "sol";
  if (!mint) return NextResponse.json({ error: "mint required" }, { status: 400 });

  const score = await scoreToken(mint, chain);
  return NextResponse.json({ chain, score });
}
