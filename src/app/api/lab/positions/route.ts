import { NextResponse } from "next/server";
import { resolveAddressPositions } from "@/lib/lab/positions";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  if (!address || address.length < 32) {
    return NextResponse.json({ error: "address query param required" }, { status: 400 });
  }
  try {
    const result = await resolveAddressPositions(address);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
