import { NextRequest, NextResponse } from "next/server";
import type { SimulationIR, IRToken } from "@/lib/foresight/simulation-ir";
import { getAuthUser } from "@/lib/auth-utils";

/**
 * /api/foresight/plan
 * ───────────────────
 * Turn ANY user what-if question + their live treasury snapshot into a strict
 * SimulationIR via Lovable AI (through the lovable-ai-proxy edge function in
 * the Lovable Cloud workspace — never direct from Vercel).
 *
 * Returns:
 *   { ok: true, ir: SimulationIR, model: string }
 *   or { ok: false, error, fallback?: { ir? } } on failure.
 *
 * The route NEVER invents numbers. If a required figure is missing (burn,
 * APY) the planner is instructed to populate `unknowns[]` so the caller can
 * surface a clarify card.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PlanBody {
  prompt: string;
  tokens: IRToken[];
  horizonMonths?: number;
  /** Optional baseline burn/inflow we already know (from analytics attribution). */
  baseline?: {
    monthlyBurnRate?: number;
    monthlyInflow?: number;
    annualYieldRate?: number;
  };
}

const SYSTEM_PROMPT = `You are Dreyv's simulation planner. You turn a user's free-form what-if treasury question into a STRICT JSON SimulationIR object — no prose, no markdown, no code fences.

The IR is then run through a deterministic engine. Your job is to translate intent precisely; the engine handles math.

SimulationIR shape:
{
  "horizonMonths": number (1..60),
  "shocks":     [{ "symbol": string, "pctChange": number signed fraction (-0.3 = drop 30%), "atMonth": number, "linear": boolean }],
  "flows":      [{ "kind": "inflow"|"outflow"|"hire"|"yield"|"fee"|"deposit", "usd"?: number, "sol"?: number, "symbol"?: string, "cadence": "monthly"|"weekly"|"one_time", "startMonth"?: number, "label"?: string }],
  "rebalances": [{ "atMonth": number, "targetAllocationPct": { "SYM": number percent } }],
  "yields":     [{ "symbol": string or "*", "apy": number fraction, "principalPct"?: number 0..1 }],
  "assumptions": string[],
  "unknowns":    string[],
  "scenarioLabel": string
}

Rules:
- Use UPPERCASE token symbols. "*" means portfolio-wide.
- pctChange is a SIGNED FRACTION: -0.3 not "30%", +0.5 not "50%".
- apy is a FRACTION: 0.08 not 8.
- For "hire X engineer at N SOL/mo" → flow kind="hire", sol=N, cadence="monthly".
- For "deposit N SOL" → flow kind="deposit", sol=N, cadence="one_time", startMonth=0.
- For "diversify to 50/30/20 SOL/USDC/JTO" → one rebalance at atMonth=0 with targetAllocationPct.
- For "what if SOL drops 40%" → shocks: [{ symbol:"SOL", pctChange:-0.4, atMonth:horizon, linear:true }].
- For "stake half on Jito at 7%" → yield: [{ symbol:"JITOSOL", apy:0.07, principalPct:0.5 }] (only if user-specified APY).
- Default horizonMonths to 12 unless user said otherwise.
- NEVER invent monthlyBurn / APY / inflow numbers. If the scenario needs one and the user didn't supply it AND no baseline value is given, add a clear entry to "unknowns" (e.g. "monthlyBurn unknown — ask user") AND OMIT the corresponding flow.
- If you DO use a baseline value, list it in "assumptions" verbatim ("Used baseline burn $12,300/mo").
- Always set scenarioLabel to a short human description.
- Output JSON ONLY. No prose.`;

function buildUserPrompt(body: PlanBody): string {
  const tokenLines = body.tokens
    .filter((t) => (t.amount ?? 0) > 0 && (t.price ?? 0) > 0)
    .map((t) => `  - ${t.symbol.toUpperCase()}: ${t.amount} @ $${t.price.toFixed(4)} (24h ${(t.change24h ?? 0).toFixed(2)}%)`)
    .join("\n") || "  (no tokens — treasury empty)";
  const totalUsd = body.tokens.reduce((s, t) => s + (t.amount ?? 0) * (t.price ?? 0), 0);
  const baselineLines: string[] = [];
  if (body.baseline?.monthlyBurnRate)
    baselineLines.push(`  monthlyBurnRate: $${Math.round(body.baseline.monthlyBurnRate).toLocaleString()}/mo`);
  if (body.baseline?.monthlyInflow)
    baselineLines.push(`  monthlyInflow:   $${Math.round(body.baseline.monthlyInflow).toLocaleString()}/mo`);
  if (body.baseline?.annualYieldRate)
    baselineLines.push(`  annualYieldRate: ${(body.baseline.annualYieldRate * 100).toFixed(2)}%`);

  return [
    `USER QUESTION: ${body.prompt}`,
    "",
    `LIVE TREASURY (total $${Math.round(totalUsd).toLocaleString()}):`,
    tokenLines,
    baselineLines.length ? `\nBASELINE ATTRIBUTION (use as defaults, list under \`assumptions\` if used):\n${baselineLines.join("\n")}` : "",
    body.horizonMonths ? `\nHORIZON: ${body.horizonMonths} months` : "",
    "",
    "Return SimulationIR JSON now.",
  ]
    .filter(Boolean)
    .join("\n");
}

function resolveProxy(): { proxyUrl: string | null; anon: string | null; reason?: string } {
  const lovableUrl = process.env.LOVABLE_SUPABASE_URL || process.env.LOVABLE_AI_PROXY_SUPABASE_URL;
  const lovableAnon = process.env.LOVABLE_SUPABASE_ANON_KEY || process.env.LOVABLE_SUPABASE_PUBLISHABLE_KEY;
  const explicit = process.env.LOVABLE_AI_PROXY_URL;
  const supaUrl = lovableUrl || (!explicit ? process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL : undefined);
  const supaAnon =
    lovableAnon ||
    (!explicit
      ? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        process.env.SUPABASE_ANON_KEY
      : undefined);
  const proxyUrl = explicit ? explicit.replace(/\/+$/, "") : supaUrl ? `${supaUrl.replace(/\/+$/, "")}/functions/v1/lovable-ai-proxy` : null;
  if (!proxyUrl || !supaAnon) {
    return { proxyUrl: null, anon: null, reason: "ai_gateway_not_configured" };
  }
  return { proxyUrl, anon: supaAnon };
}

function safeParseIR(raw: string): SimulationIR | null {
  try {
    // Strip code fences if present.
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    const ir = JSON.parse(cleaned);
    if (!ir || typeof ir !== "object") return null;
    if (typeof ir.horizonMonths !== "number") ir.horizonMonths = 12;
    ir.shocks = Array.isArray(ir.shocks) ? ir.shocks : [];
    ir.flows = Array.isArray(ir.flows) ? ir.flows : [];
    ir.rebalances = Array.isArray(ir.rebalances) ? ir.rebalances : [];
    ir.yields = Array.isArray(ir.yields) ? ir.yields : [];
    ir.assumptions = Array.isArray(ir.assumptions) ? ir.assumptions.map(String) : [];
    ir.unknowns = Array.isArray(ir.unknowns) ? ir.unknowns.map(String) : [];
    if (typeof ir.scenarioLabel !== "string") ir.scenarioLabel = "Custom scenario";
    return ir as SimulationIR;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: PlanBody;
  try {
    body = (await req.json()) as PlanBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  if (!body?.prompt || typeof body.prompt !== "string") {
    return NextResponse.json({ ok: false, error: "prompt_required" }, { status: 400 });
  }
  if (!Array.isArray(body.tokens)) {
    return NextResponse.json({ ok: false, error: "tokens_required" }, { status: 400 });
  }

  const { proxyUrl, anon, reason } = resolveProxy();
  if (!proxyUrl || !anon) {
    return NextResponse.json({ ok: false, error: reason || "ai_gateway_not_configured" }, { status: 503 });
  }

  const upstream = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${anon}`,
      apikey: anon,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(body) },
      ],
      stream: false,
      response_format: { type: "json_object" },
    }),
  }).catch((e) => {
    console.error("[foresight/plan] proxy fetch failed", e);
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ ok: false, error: "proxy_unreachable" }, { status: 502 });
  }
  if (!upstream.ok) {
    if (upstream.status === 429) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    if (upstream.status === 402) return NextResponse.json({ ok: false, error: "credits_required" }, { status: 402 });
    const t = await upstream.text().catch(() => "");
    console.error("[foresight/plan] gateway error", upstream.status, t);
    return NextResponse.json({ ok: false, error: "ai_gateway_error" }, { status: 502 });
  }

  const data = await upstream.json().catch(() => null);
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  if (!text) {
    return NextResponse.json({ ok: false, error: "empty_response" }, { status: 502 });
  }
  const ir = safeParseIR(text);
  if (!ir) {
    console.error("[foresight/plan] failed to parse IR", text.slice(0, 500));
    return NextResponse.json({ ok: false, error: "parse_failed", raw: text.slice(0, 500) }, { status: 502 });
  }

  // Inject the live token snapshot as startState (planner only emits the
  // dynamics, never invents holdings).
  ir.startState = {
    tokens: body.tokens.map((t) => ({
      symbol: String(t.symbol ?? "").toUpperCase(),
      amount: Number(t.amount) || 0,
      price: Number(t.price) || 0,
      change24h: typeof t.change24h === "number" ? t.change24h : undefined,
      isStable: t.isStable,
      mint: t.mint,
      logo: t.logo,
    })),
    usd: body.tokens.reduce((s, t) => s + (Number(t.amount) || 0) * (Number(t.price) || 0), 0),
  };

  return NextResponse.json({ ok: true, ir, model: "google/gemini-3-flash-preview" });
}
