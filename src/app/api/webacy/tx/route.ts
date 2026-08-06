import { NextRequest, NextResponse } from "next/server";
import { scoreTransaction } from "@/lib/webacy/service";
import { publicRateLimitOrResponse } from "@/lib/public-rate-limit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = publicRateLimitOrResponse(req, { bucket: "webacy-tx", max: 20, windowMs: 60_000 });
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const chain = typeof body?.chain === "string" ? body.chain : "sol";
  const signature = typeof body?.signature === "string" ? body.signature : undefined;
  const serializedTx = typeof body?.serializedTx === "string" ? body.serializedTx : undefined;
  const signer = typeof body?.signer === "string" ? body.signer : undefined;

  if (!signature && !serializedTx) {
    return NextResponse.json({ error: "signature or serializedTx required" }, { status: 400 });
  }

  const score = await scoreTransaction({ chain, signature, serializedTx, signer });
  return NextResponse.json({ chain, score });
}
