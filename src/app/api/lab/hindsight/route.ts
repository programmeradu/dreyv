import { NextResponse } from "next/server";
import { resolveAddressPositions, fetchCurrentApys } from "@/lib/lab/positions";
import { fetchManyHistories } from "@/lib/lab/prices";
import { computeHindsight } from "@/lib/lab/engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  const w = Number(url.searchParams.get("window") ?? 90);
  const windowDays: 30 | 90 | 365 = w === 30 ? 30 : w === 365 ? 365 : 90;
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });
  try {
    const { positions, totalUsd, warnings } = await resolveAddressPositions(address);
    const mints = Array.from(new Set(positions.map((p) => p.mint)));
    const [apys, histories] = await Promise.all([
      fetchCurrentApys(),
      fetchManyHistories(mints, windowDays),
    ]);
    const missed = computeHindsight(positions, apys, histories, windowDays);
    const totalOppCostUsd = missed.reduce((s, m) => s + m.realizedOppCostUsd, 0);
    return NextResponse.json({ positions, totalUsd, missed, totalOppCostUsd, windowDays, warnings });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
