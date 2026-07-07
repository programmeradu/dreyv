import { NextRequest, NextResponse } from "next/server";
import { scoreUrls } from "@/lib/webacy/service";
import { publicRateLimitOrResponse } from "@/lib/public-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = publicRateLimitOrResponse(req, { bucket: "webacy-url", max: 30, windowMs: 60_000 });
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const urls: string[] = Array.isArray(body?.urls) ? body.urls.filter((u: unknown) => typeof u === "string") : [];
  if (urls.length === 0) return NextResponse.json({ error: "urls required" }, { status: 400 });
  if (urls.length > 20) return NextResponse.json({ error: "max 20 urls per call" }, { status: 400 });

  const scores = await scoreUrls(urls);
  return NextResponse.json({ scores: Object.fromEntries(scores) });
}
