import { NextRequest, NextResponse } from "next/server";
import { buildFeaturePack } from "@/lib/explorer/feature-pack";
import { checkPublicRateLimit } from "@/lib/public-rate-limit";
import { isValidSolanaAddress } from "@/lib/atlas-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const rl = checkPublicRateLimit(req, { bucket: "risk", max: 30 });
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const pack = await buildFeaturePack(address);

  // HHI on USD weights
  const hhi = pack.composition.reduce((acc, c) => acc + c.pctUsd * c.pctUsd, 0); // 0..1
  const concentrationScore = Math.max(0, 1 - hhi); // 1 = perfectly diversified

  const unverifiedPct = pack.composition.reduce((acc, c) => acc + (c.symbol === "UNKNOWN" ? c.pctUsd : 0), 0);
  const unverifiedScore = 1 - unverifiedPct;

  const hygieneScore = pack.isMultisig ? 1 : 0.5;
  const protoConcentration = pack.topProtocols.length > 0 ? Math.min(1, pack.topProtocols.length / 3) : 0.5;

  const overall = Math.round(
    (concentrationScore * 0.4 + unverifiedScore * 0.2 + hygieneScore * 0.2 + protoConcentration * 0.2) * 100,
  );

  return NextResponse.json(
    {
      score: overall,
      factors: [
        { label: "Diversification", weight: 0.4, value: Math.round(concentrationScore * 100), note: `HHI ${hhi.toFixed(2)}` },
        { label: "Unverified tokens", weight: 0.2, value: Math.round(unverifiedScore * 100), note: `${(unverifiedPct * 100).toFixed(0)}% in unverified mints` },
        { label: "Signing hygiene", weight: 0.2, value: Math.round(hygieneScore * 100), note: pack.isMultisig ? "Multisig protected" : "Single signer" },
        { label: "Protocol spread", weight: 0.2, value: Math.round(protoConcentration * 100), note: `${pack.topProtocols.length} protocols touched` },
      ],
    },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
