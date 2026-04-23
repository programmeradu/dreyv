/**
 * Gemini deep reasoning — invoked only on `escalate` verdicts from triage.
 * Uses Google AI Studio's Gemini 3 Pro for long-context, multi-signal
 * reasoning to produce a concrete proposal/alert.
 *
 * Falls back to a structured stub (still routable downstream) when
 * `GEMINI_API_KEY` is missing so the bus stays alive in dev.
 */

import type { OpportunitySummary, TriageResult } from "./groq-triage";

export interface DeepProposal {
  kind: "proposal" | "alert";
  title: string;
  thesis: string;
  actions: Array<{
    op:
      | "swap"
      | "stake"
      | "unstake"
      | "deposit_yield"
      | "withdraw"
      | "rebalance"
      | "alert_only"
      | "spawn_subagent";
    params: Record<string, unknown>;
    rationale: string;
  }>;
  riskNotes: string[];
  confidence: number; // 0-1
  horizon: "minutes" | "hours" | "days" | "weeks";
  model: string;
  raw?: unknown;
}

const MODEL = "gemini-3-pro-preview"; // Gemini 3 Pro (preview ID on AI Studio)
const FALLBACK_MODEL = "gemini-2.5-pro"; // safe fallback if 3 Pro is gated

const SYSTEM = `You are Dreyv's deep reasoning agent for autonomous treasury / on-chain ops.
You receive a triaged opportunity (already deemed worth deep thought) and must
return STRICT JSON of shape:
{
  "kind":"proposal|alert",
  "title":"<=80 chars",
  "thesis":"<=600 chars, why this matters now",
  "actions":[{"op":"swap|stake|unstake|deposit_yield|withdraw|rebalance|alert_only|spawn_subagent","params":{...},"rationale":"<=200 chars"}],
  "riskNotes":["short risk callouts"],
  "confidence":0..1,
  "horizon":"minutes|hours|days|weeks"
}

Rules:
- NEVER fabricate balances, prices, or addresses not present in the input.
- If sizing depends on user exposure and none is provided, prefer "alert_only"
  with a clarifying ask in the thesis.
- Prefer one or two crisp actions over a long shopping list.`;

async function callGemini(model: string, body: unknown, key: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`gemini ${model} ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p: any) => p?.text ?? "").join("");
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function fallbackProposal(opp: OpportunitySummary, triage: TriageResult): DeepProposal {
  return {
    kind: "alert",
    title: `Watch: ${triage.reason}`.slice(0, 80),
    thesis:
      "Deep reasoning unavailable (no GEMINI_API_KEY). Triage flagged this as escalate; surfacing as alert pending live deep model.",
    actions: [
      {
        op: "alert_only",
        params: { source: opp.reason },
        rationale: "Pipeline alive; routing as alert until Gemini key is configured.",
      },
    ],
    riskNotes: ["No deep reasoning performed."],
    confidence: triage.confidence,
    horizon: "hours",
    model: "stub",
  };
}

export async function deepReason(
  opp: OpportunitySummary,
  triage: TriageResult,
): Promise<DeepProposal> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) return fallbackProposal(opp, triage);

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `TRIAGE:\n${JSON.stringify(triage)}\n\nOPPORTUNITY:\n${JSON.stringify(opp).slice(0, 8000)}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1200,
      responseMimeType: "application/json",
    },
  };

  let raw = "";
  let usedModel = MODEL;
  try {
    raw = await callGemini(MODEL, body, key);
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn("[deep:gemini3] fallback ->", e?.message);
    try {
      usedModel = FALLBACK_MODEL;
      raw = await callGemini(FALLBACK_MODEL, body, key);
    } catch (e2: any) {
      // eslint-disable-next-line no-console
      console.warn("[deep:gemini2] also failed", e2?.message);
      return fallbackProposal(opp, triage);
    }
  }

  try {
    const parsed = JSON.parse(stripFences(raw));
    const kind = parsed.kind === "proposal" ? "proposal" : "alert";
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
    return {
      kind,
      title: String(parsed.title ?? "Untitled").slice(0, 80),
      thesis: String(parsed.thesis ?? "").slice(0, 1200),
      actions: actions.slice(0, 6).map((a: any) => ({
        op: String(a.op ?? "alert_only") as DeepProposal["actions"][number]["op"],
        params: (a.params && typeof a.params === "object") ? a.params : {},
        rationale: String(a.rationale ?? "").slice(0, 240),
      })),
      riskNotes: Array.isArray(parsed.riskNotes) ? parsed.riskNotes.slice(0, 8).map(String) : [],
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      horizon: ["minutes", "hours", "days", "weeks"].includes(parsed.horizon) ? parsed.horizon : "hours",
      model: `gemini:${usedModel}`,
      raw: undefined,
    };
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn("[deep:parse] fallback", e?.message);
    return fallbackProposal(opp, triage);
  }
}
