import { NextRequest, NextResponse } from "next/server";
import { walletApprovals } from "@/lib/webacy/service";
import { publicRateLimitOrResponse } from "@/lib/public-rate-limit";
import { getAuthUser } from "@/lib/auth-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = publicRateLimitOrResponse(req, { bucket: "webacy-approvals", max: 20, windowMs: 60_000 });
  if (limited) return limited;

  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  const chain = typeof body?.chain === "string" ? body.chain : "sol";
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });

  const approvals = await walletApprovals(wallet, chain);
  return NextResponse.json({ approvals });
}
