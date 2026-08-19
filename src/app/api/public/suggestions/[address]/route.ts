import { NextRequest, NextResponse } from "next/server";
import { buildFeaturePack } from "@/lib/explorer/feature-pack";
import { checkPublicRateLimit } from "@/lib/public-rate-limit";
import { isValidSolanaAddress } from "@/lib/atlas-utils";
import { aiComplete, aiConfigured } from "@/lib/ai-gateway";

export const dynamic = "force-dynamic";

const SYSTEM_SUGGESTIONS = `You are Dreyv's wallet advisor. Given the supplied facts, return STRICT JSON:
{"suggestions":[{"title":"...", "detail":"...", "intent":"stake|consolidate|yield|swap|hedge|fee_optimize|close_dust|automate_dca|alerts|watch"}]}
Return 2 to 4 suggestions, ONLY ones the facts directly support. Prefer suggestions tied to a concrete dollar impact.
Each title <= 60 chars, action-led. Each detail <= 120 chars, with concrete numbers from the facts.
Voice: calm, founder-to-founder. Friendly to non-technical readers. Banned words: revolutionize, game-changer, synergy, disrupt, next-gen, leverage, supercharge.
If no suggestion is supported, return {"suggestions":[]}.`;

export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const rl = checkPublicRateLimit(req, { bucket: "suggestions", max: 20 });
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const pack = await buildFeaturePack(address);

  // Deterministic baseline suggestions from raw facts — the model then refines wording.
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

  // Refine wording when a model is available; otherwise return the baseline.
  if (aiConfigured() && baseline.length) {
    try {
      const refined = (await aiComplete({
        messages: [
          { role: "system", content: SYSTEM_SUGGESTIONS },
          { role: "user", content: JSON.stringify({ featurePack: pack, baseline }) },
        ],
        response_format: { type: "json_object" },
        timeoutMs: 20_000,
      })) as { suggestions?: Array<{ title: string; detail: string; intent: string }> } | null;
      if (Array.isArray(refined?.suggestions) && refined.suggestions.length) {
        return NextResponse.json({ suggestions: refined.suggestions });
      }
    } catch {
      // fall through to baseline
    }
  }

  return NextResponse.json({ suggestions: baseline });
}
