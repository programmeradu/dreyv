import { NextRequest, NextResponse } from "next/server";
import { buildFeaturePack } from "@/lib/explorer/feature-pack";
import { checkPublicRateLimit } from "@/lib/public-rate-limit";
import { isValidSolanaAddress } from "@/lib/atlas-utils";
export const runtime = "edge";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const rl = checkPublicRateLimit(req, { bucket: "suggestions", max: 20 });
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const pack = await buildFeaturePack(address);

  // Deterministic baseline suggestions from raw facts — Lovable AI then refines wording.
  const baseline: Array<{ title: string; detail: string; intent: string }> = [];
  if (pack.idle.solUiAmount > 5) {
    const apr = pack.topYields.find((y) => /sol/i.test(y.symbol))?.apy ?? 7;
    const yearly = pack.idle.solUiAmount * apr / 100;
    baseline.push({
      title: `Stake ${pack.idle.solUiAmount.toFixed(1)} idle SOL`,
      detail: `~${yearly.toFixed(2)} SOL/yr at ${apr.toFixed(1)}% APR via a top-tier LST.`,
      intent: "stake",
    });
  }
  if (pack.idle.emptyTokenAccounts >= 3) {
    const rent = pack.idle.emptyTokenAccounts * 0.00203928;
    baseline.push({
      title: `Reclaim rent from ${pack.idle.emptyTokenAccounts} empty accounts`,
      detail: `Close them to recover about ${rent.toFixed(4)} SOL of locked rent.`,
      intent: "consolidate",
    });
  }
  if (pack.idle.usdcUiAmount > 500 && pack.topYields.length) {
    const y = pack.topYields.find((x) => /usdc/i.test(x.symbol)) ?? pack.topYields[0]!;
    baseline.push({
      title: `Deploy ${Math.round(pack.idle.usdcUiAmount).toLocaleString()} USDC at ${y.apy.toFixed(1)}%`,
      detail: `Park stables in ${y.protocol} (${y.riskTier} risk) instead of sitting idle.`,
      intent: "yield",
    });
  }

  // If Lovable AI is available, refine wording; else return baseline.
  if (SUPABASE_URL && ANON && baseline.length) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/public-narrative`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON}`, apikey: ANON },
        body: JSON.stringify({ mode: "suggestions", featurePack: pack }),
      });
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j?.suggestions) && j.suggestions.length) {
          return NextResponse.json({ suggestions: j.suggestions });
        }
      }
    } catch {
      // fall through to baseline
    }
  }
  return NextResponse.json({ suggestions: baseline });
}
