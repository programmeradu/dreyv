import { NextResponse } from "next/server";
import { PLAYBOOK_LIBRARY } from "@/lib/lab/playbooks-library";
import { resolveAddressPositions, fetchCurrentApys } from "@/lib/lab/positions";
import { fetchManyHistories } from "@/lib/lab/prices";
import { backtestPlaybook } from "@/lib/lab/engine";

export const dynamic = "force-dynamic";

const REF_MINTS = [
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  const id = url.searchParams.get("id");
  if (!address || !id) return NextResponse.json({ error: "address and id required" }, { status: 400 });
  const pb = PLAYBOOK_LIBRARY.find((p) => p.id === id);
  if (!pb) return NextResponse.json({ error: "playbook not found" }, { status: 404 });

  try {
    const { positions, totalUsd } = await resolveAddressPositions(address);
    const mints = Array.from(new Set([...positions.map((p) => p.mint), ...REF_MINTS]));
    const [apys, histories] = await Promise.all([
      fetchCurrentApys(),
      fetchManyHistories(mints, 365),
    ]);
    const result = backtestPlaybook(pb, positions, histories, apys, 365);
    return NextResponse.json({ playbook: pb, result, totalUsd });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
