import { NextResponse } from "next/server";
import { resolveAddressPositions, fetchCurrentApys } from "@/lib/lab/positions";
import { fetchManyHistories } from "@/lib/lab/prices";
import { computeForesight } from "@/lib/lab/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });
  try {
    const { positions, totalUsd, warnings } = await resolveAddressPositions(address);
    const mints = Array.from(new Set(positions.map((p) => p.mint)));
    const [apys, histories] = await Promise.all([
      fetchCurrentApys(),
      fetchManyHistories(mints, 90),
    ]);
    const rotations = computeForesight(positions, apys, histories);
    return NextResponse.json({ positions, totalUsd, rotations, warnings });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
