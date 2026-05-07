import { NextResponse } from "next/server";
import { FOUNDING_CAP, getFoundingClaimedCount } from "@/lib/founding/claim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const claimed = await getFoundingClaimedCount();
    const remaining = Math.max(0, FOUNDING_CAP - claimed);
    return NextResponse.json(
      { claimed, remaining, cap: FOUNDING_CAP, open: remaining > 0 },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch {
    return NextResponse.json(
      { claimed: 0, remaining: FOUNDING_CAP, cap: FOUNDING_CAP, open: true },
      { status: 200 },
    );
  }
}
