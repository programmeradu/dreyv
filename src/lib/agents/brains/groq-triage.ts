/**
 * Groq triage — fast, cheap first-pass classifier on every surfaced
 * opportunity. Returns one of: drop | watch | escalate, plus a short reason.
 *
 * Designed to keep the deep-reasoning (Gemini) bill small by gating on a
 * sub-second llama-3.3-70b call. Falls back to a deterministic heuristic when
 * `GROQ_API_KEY` is missing so the pipeline still flows in dev.
 */

export type TriageVerdict = "drop" | "watch" | "escalate";

export interface TriageResult {
  verdict: TriageVerdict;
  confidence: number; // 0-1
  reason: string;
  tags: string[];
  model: string;
}

export interface OpportunitySummary {
  reason: string;
  window?: string;
  movers?: Array<{ symbol?: string; changePct?: number; priceUsd?: number }>;
  pools?: Array<{ protocol?: string; asset?: string; apy?: number; tvlUsd?: number; riskScore?: number }>;
  observedAt: string;
  [k: string]: unknown;
}

const SYSTEM = `You are Dreyv's opportunity triage agent.
Given a surfaced opportunity (market mover, yield pool, intel signal), respond
with STRICT JSON: {"verdict":"drop|watch|escalate","confidence":0..1,"reason":"<=140 chars","tags":["..."]}

Rules:
- "escalate" = clearly actionable now, worth deep reasoning.
- "watch"    = interesting, needs more data or time.
- "drop"     = noise / known / not actionable.
Be conservative. Default to "watch" when unsure.`;

function heuristic(opp: OpportunitySummary): TriageResult {
  const movers = opp.movers ?? [];
  const pools = opp.pools ?? [];
  const big = movers.find((m) => Math.abs(m.changePct ?? 0) >= 8);
  const juicy = pools.find((p) => (p.apy ?? 0) >= 20 && (p.riskScore ?? 100) < 50);
  if (big || juicy) {
    return {
      verdict: "escalate",
      confidence: 0.6,
      reason: big
        ? `Fast mover ${big.symbol} ${big.changePct?.toFixed(1)}%`
        : `High-APY pool ${juicy?.asset} ${juicy?.apy?.toFixed(1)}%`,
      tags: big ? ["mover"] : ["yield"],
      model: "heuristic",
    };
  }
  return {
    verdict: "watch",
    confidence: 0.4,
    reason: `Heuristic watch: ${opp.reason}`,
    tags: [opp.reason],
    model: "heuristic",
  };
}

export async function triageOpportunity(opp: OpportunitySummary): Promise<TriageResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return heuristic(opp);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.2,
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: JSON.stringify(opp).slice(0, 4000) },
        ],
      }),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn("[triage:groq] status", res.status);
      return heuristic(opp);
    }
    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const verdict: TriageVerdict =
      parsed.verdict === "escalate" || parsed.verdict === "drop" ? parsed.verdict : "watch";
    return {
      verdict,
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      reason: String(parsed.reason ?? "").slice(0, 200) || "no-reason",
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6).map(String) : [],
      model: "groq:llama-3.3-70b",
    };
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn("[triage:groq] exception", e?.message || e);
    return heuristic(opp);
  }
}
