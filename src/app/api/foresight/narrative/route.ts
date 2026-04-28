/**
 * /api/foresight/narrative
 *
 * Streams a plain-English explanation of a Monte Carlo foresight result via
 * the Lovable AI Gateway. The client passes the projection summary + the
 * user's original what-if prompt; we return SSE chunks that the Analytics
 * page renders progressively.
 *
 * Phase 14 — foresight foundation.
 */
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface NarrativeBody {
  prompt?: string;            // original user what-if prompt
  summary: {
    currentValue: number;
    p10: number;
    p50: number;
    p90: number;
    depletionProbability: number;
    medianDepletionMonths: number | null;
    riskFlags: string[];
  };
  variables?: Array<{ label: string; value: number; unit?: string; asset?: string }>;
  timeframeMonths: number;
  attribution?: {
    inflowUsd: number;
    outflowUsd: number;
    yieldUsd: number;
    feeUsd: number;
    monthlyBurnRate: number;
    monthlyInflow: number;
    annualYieldRate: number;
  };
}

const SYSTEM_PROMPT = `You are Dreyv's treasury foresight narrator. Given a Monte Carlo projection summary, write 3 short paragraphs (markdown, no headings) for a treasury operator:

1. **What the simulation says** — translate p10/p50/p90 into one human sentence ("a typical path lands near \$X, but the worst 10% of paths fall below \$Y"). Use real dollar amounts.
2. **The biggest driver** — name the variable or attribution metric that explains most of the swing. Be specific.
3. **One concrete next step** — a single, actionable recommendation tied to a Dreyv capability (rebalance into stables, set a runway alert, route idle cash into yield, raise inflow, throttle a payroll schedule, etc.).

Rules:
- No emojis. No "as an AI" disclaimers. No bullet points.
- Refer to numbers in compact USD (\$1.2M, \$840K, \$12.5K).
- If depletion probability ≥ 30%, lead with the risk.
- If the user passed only stablecoins or zero volatility, tone down uncertainty language.
- Maximum 140 words total.`;

export async function POST(req: NextRequest) {
  let body: NarrativeBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }
  if (!body?.summary || typeof body.summary.currentValue !== "number") {
    return new Response(JSON.stringify({ error: "summary_required" }), { status: 400 });
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
    if (upstream.status === 429) {
      return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 });
    }
    if (upstream.status === 402) {
      return new Response(JSON.stringify({ error: "credits_required" }), { status: 402 });
    }
    const t = await upstream.text().catch(() => "");
    console.error("[foresight/narrative] gateway error", upstream.status, t);
    return new Response(JSON.stringify({ error: "ai_gateway_error" }), { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
    },
  });
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function buildUserPrompt(b: NarrativeBody): string {
  const { summary, variables = [], timeframeMonths, attribution, prompt } = b;
  const varLines = variables.length
    ? variables.map((v) => `- ${v.label}${v.asset ? ` (${v.asset})` : ""}: ${v.value}${v.unit ?? ""}`).join("\n")
    : "(none — baseline projection)";
  const attrLine = attribution
    ? `Attribution (last window): inflow ${fmtUsd(attribution.inflowUsd)}, outflow ${fmtUsd(attribution.outflowUsd)}, yield ${fmtUsd(attribution.yieldUsd)}, fees ${fmtUsd(attribution.feeUsd)}; burn rate ${fmtUsd(attribution.monthlyBurnRate)}/mo, inflow ${fmtUsd(attribution.monthlyInflow)}/mo, realized APY ${(attribution.annualYieldRate * 100).toFixed(1)}%.`
    : "Attribution: not yet available.";
  return [
    prompt ? `User asked: "${prompt}"` : "User opened Foresight without a specific prompt.",
    "",
    `Horizon: ${timeframeMonths} months.`,
    `Current treasury value: ${fmtUsd(summary.currentValue)}.`,
    `Monte Carlo bands at horizon end:`,
    `- P10 (worst 10%): ${fmtUsd(summary.p10)}`,
    `- P50 (median): ${fmtUsd(summary.p50)}`,
    `- P90 (best 10%): ${fmtUsd(summary.p90)}`,
    `Probability of depletion within horizon: ${(summary.depletionProbability * 100).toFixed(1)}%.`,
    summary.medianDepletionMonths != null
      ? `Median depletion month (across paths that depleted): ${summary.medianDepletionMonths}.`
      : `No paths depleted within horizon.`,
    `Risk flags: ${summary.riskFlags.length ? summary.riskFlags.join(", ") : "none"}.`,
    "",
    `What-if variables applied:\n${varLines}`,
    "",
    attrLine,
  ].join("\n");
}
