/**
 * /api/analytics/insights
 *
 * Streams two segments in one SSE response, anchored on the user's REAL
 * live treasury data passed by the client (no demo numbers, ever):
 *
 *   <<NARRATIVE>>     ← "what changed since yesterday" (markdown, ~80 words)
 *   <<SUGGESTIONS>>   ← 3 next questions, one per line, derived from THIS
 *                       user's data (e.g. "Why did fees jump 3.2x this week?")
 *   <<END>>
 *
 * The client splits the streamed text on those sentinels and renders both
 * progressively (token-by-token). No hardcoded prompts.
 */
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InsightsBody {
  vaultValue: number;
  vaultChange24h: number | null;
  topAsset: { symbol: string; sharePct: number } | null;
  attribution: {
    inflowUsd: number;
    outflowUsd: number;
    yieldUsd: number;
    feeUsd: number;
    netUsd: number;
    monthlyBurnRate: number;
    monthlyInflow: number;
    annualYieldRate: number;
    sampleSize: number;
  } | null;
  snapshotStats: { driftPctPerDay: number; volPctPerDay: number; samples: number } | null;
  foresight: { depletionProbability: number; medianDepletionMonths: number | null } | null;
  /** Yesterday vs today deltas (computed client-side from snapshots) */
  diff: {
    valueDeltaPct: number | null;
    feeDeltaPct: number | null;
    burnDeltaPct: number | null;
    yieldDeltaPct: number | null;
    concentrationDeltaPct: number | null;
  } | null;
}

const SYSTEM_PROMPT = `You are Dreyv's analytics narrator. You produce TWO segments in one stream, separated by exact sentinels.

OUTPUT FORMAT (no other text, no preamble):
<<NARRATIVE>>
<2-3 short sentences in markdown, no headings, plain language, max 80 words. Lead with the single biggest thing that changed since yesterday for THIS treasury. Use compact USD ($1.2M, $840K, $12.5K). If nothing changed meaningfully, say so plainly.>
<<SUGGESTIONS>>
<question 1>
<question 2>
<question 3>
<<END>>

Suggestion rules:
- Each question must reference a real number, asset, or trend from the data provided. Never generic.
- Questions should be answerable by Dreyv's analytics or a what-if simulation.
- Mix: one diagnostic ("why X?"), one forward-looking ("what if Y?"), one operational ("should we Z?").
- 8-14 words each. No emojis. No quotes.

Strict:
- No "as an AI" disclaimers. No bullet points in the narrative.
- Never invent numbers. If a field is null/zero, treat it as missing — don't fabricate.`;

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function buildUserPrompt(b: InsightsBody): string {
  const { vaultValue, vaultChange24h, topAsset, attribution, snapshotStats, foresight, diff } = b;
  const lines: string[] = [];
  lines.push(`Treasury value: ${fmtUsd(vaultValue)}.`);
  if (vaultChange24h != null) lines.push(`24h change: ${vaultChange24h >= 0 ? "+" : ""}${vaultChange24h.toFixed(2)}%.`);
  if (topAsset) lines.push(`Top asset: ${topAsset.symbol.toUpperCase()} at ${topAsset.sharePct.toFixed(1)}% of treasury.`);
  if (attribution) {
    lines.push(`Last 30d attribution: inflow ${fmtUsd(attribution.inflowUsd)}, outflow ${fmtUsd(attribution.outflowUsd)}, yield ${fmtUsd(attribution.yieldUsd)}, fees ${fmtUsd(attribution.feeUsd)}, net ${fmtUsd(attribution.netUsd)}.`);
    lines.push(`Monthly burn ${fmtUsd(attribution.monthlyBurnRate)}, inflow ${fmtUsd(attribution.monthlyInflow)}, realized APY ${(attribution.annualYieldRate * 100).toFixed(2)}%, sample ${attribution.sampleSize} events.`);
  } else {
    lines.push(`Attribution: no events recorded yet.`);
  }
  if (snapshotStats) {
    lines.push(`Realized vol ${(snapshotStats.volPctPerDay * 100).toFixed(2)}%/day, drift ${(snapshotStats.driftPctPerDay * 100).toFixed(2)}%/day, ${snapshotStats.samples} snapshots.`);
  }
  if (foresight) {
    lines.push(`Monte Carlo: ${(foresight.depletionProbability * 100).toFixed(1)}% depletion probability, median depletion ${foresight.medianDepletionMonths ?? "n/a"} months.`);
  }
  if (diff) {
    const parts: string[] = [];
    if (diff.valueDeltaPct != null) parts.push(`value ${diff.valueDeltaPct >= 0 ? "+" : ""}${diff.valueDeltaPct.toFixed(2)}%`);
    if (diff.feeDeltaPct != null) parts.push(`fees ${diff.feeDeltaPct >= 0 ? "+" : ""}${diff.feeDeltaPct.toFixed(1)}%`);
    if (diff.burnDeltaPct != null) parts.push(`burn ${diff.burnDeltaPct >= 0 ? "+" : ""}${diff.burnDeltaPct.toFixed(1)}%`);
    if (diff.yieldDeltaPct != null) parts.push(`yield ${diff.yieldDeltaPct >= 0 ? "+" : ""}${diff.yieldDeltaPct.toFixed(1)}%`);
    if (diff.concentrationDeltaPct != null) parts.push(`concentration ${diff.concentrationDeltaPct >= 0 ? "+" : ""}${diff.concentrationDeltaPct.toFixed(1)}pp`);
    if (parts.length) lines.push(`Day-over-day deltas: ${parts.join(", ")}.`);
  }
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  let body: InsightsBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }
  if (typeof body?.vaultValue !== "number") {
    return new Response(JSON.stringify({ error: "vaultValue_required" }), { status: 400 });
  }

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ai_gateway_not_configured" }), { status: 503 });
  }

  const userPrompt = buildUserPrompt(body);

  const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      stream: true,
    }),
  });

  if (!upstream.ok) {
    if (upstream.status === 429) return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 });
    if (upstream.status === 402) return new Response(JSON.stringify({ error: "credits_required" }), { status: 402 });
    const t = await upstream.text().catch(() => "");
    console.error("[analytics/insights] gateway error", upstream.status, t);
    return new Response(JSON.stringify({ error: "ai_gateway_error" }), { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
    },
  });
}
