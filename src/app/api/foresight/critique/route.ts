import { NextRequest, NextResponse } from "next/server";
import type { SimulationIR } from "@/lib/foresight/simulation-ir";
import { getAuthUser } from "@/lib/auth-utils";
import { aiComplete, aiConfigured } from "@/lib/ai-gateway";

/**
 * /api/foresight/critique
 * ───────────────────────
 * Verification pass — given the original user prompt, the planned IR, and the
 * engine result, ask the LLM to either:
 *   - approve   → { verdict: "approved", followUps: [] }
 *   - amend     → { verdict: "amend",    followUps: ["did you also mean ..."] }
 *
 * Pure observation; never mutates the IR. Caller decides what to do with the
 * follow-ups (we render them as chips under the result).
 */

export const dynamic = "force-dynamic";

interface CritiqueBody {
  prompt: string;
  ir: SimulationIR;
  result: {
    startValue: number;
    endValue: number;
    runwayMonths: number | null;
    riskFlags: string[];
  };
}

const SYSTEM = `You are Dreyv's simulation critic. You receive a user's free-form what-if question, the SimulationIR the planner produced, and the engine result.

Return STRICT JSON:
{ "verdict": "approved" | "amend", "rationale": string (<= 140 chars), "followUps": string[] (0..3 short suggested next-step prompts the user can click) }

Rules:
- "approved" when IR captures the question and result is internally consistent.
- "amend" when the IR misses an obvious axis (e.g. user asked about both shock AND yield but yield missing) — still mark approved if the omission is a missing baseline value already listed in unknowns.
- followUps are short imperative prompts ("Also model 5% USDC depeg", "Re-run with 8% Marinade APY"), no questions, max 60 chars each.
- NEVER suggest unrelated tangents.
- If unknowns are non-empty, prefer suggesting the user supply that value as a follow-up instead of inventing one.
- JSON ONLY. No prose, no fences.`;

export async function POST(req: NextRequest) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: CritiqueBody;
  try {
    body = (await req.json()) as CritiqueBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  if (!body?.prompt || !body?.ir) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }
  if (!aiConfigured()) {
    return NextResponse.json({ ok: true, verdict: "approved", rationale: "(critic offline)", followUps: [] });
  }

  // Compress IR for token economy.
  const compactIR = {
    horizonMonths: body.ir.horizonMonths,
    scenarioLabel: body.ir.scenarioLabel,
    shocks: body.ir.shocks,
    flows: body.ir.flows,
    rebalances: body.ir.rebalances,
    yields: body.ir.yields,
    assumptions: body.ir.assumptions,
    unknowns: body.ir.unknowns,
  };

  const userMsg = [
    `USER QUESTION: ${body.prompt}`,
    `IR: ${JSON.stringify(compactIR)}`,
    `RESULT: start=$${Math.round(body.result.startValue).toLocaleString()} end=$${Math.round(body.result.endValue).toLocaleString()} runway=${body.result.runwayMonths ?? "n/a"} flags=[${body.result.riskFlags.join(",")}]`,
  ].join("\n");

  const raw = await aiComplete({
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userMsg },
    ],
    response_format: { type: "json_object" },
    timeoutMs: 20_000,
  });

  if (!raw) {
    return NextResponse.json({ ok: true, verdict: "approved", rationale: "(critic unreachable)", followUps: [] });
  }

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return NextResponse.json({
      ok: true,
      verdict: parsed.verdict === "amend" ? "amend" : "approved",
      rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 200) : "",
      followUps: Array.isArray(parsed.followUps) ? parsed.followUps.slice(0, 3).map((s: unknown) => String(s).slice(0, 80)) : [],
    });
  } catch {
    return NextResponse.json({ ok: true, verdict: "approved", rationale: "(parse failed)", followUps: [] });
  }
}
