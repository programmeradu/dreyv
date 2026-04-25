/**
 * DACS Phase 1 — Plan synthesis.
 *
 * Takes a typed `Intent` + the capability registry, produces a typed `Plan`
 * with ordered `CapabilityCall[]`, rationale, reversibility, and risk score.
 *
 * Strategy:
 *   - Simple intents (single capability, high confidence) → Groq llama-3.3.
 *   - Complex / multi-step / low-confidence → Gemini deep when GEMINI_API_KEY
 *     is present, else falls back to Groq.
 *
 * The planner ONLY references capabilities present in the registry. It cannot
 * invent tools (Phase 2 dynamic composition lifts that restriction inside the
 * sandbox-runner allowlist).
 */

import { listCapabilities } from "../capabilities/registry";
import type { Intent, Plan } from "./types";

function capabilityCatalogForLLM(): string {
  return listCapabilities()
    .map((c) => `- ${c.id} [${c.domain}/${c.sideEffects}/${c.sensitivity}]: ${c.description}`)
    .join("\n");
}

function reversibilityFromSideEffects(steps: Plan["steps"]): Plan["reversibility"] {
  const caps = listCapabilities();
  const byId = new Map(caps.map((c) => [c.id, c]));
  let hasWrite = false;
  let hasIrreversible = false;
  for (const s of steps) {
    const cap = byId.get(s.capabilityId);
    if (!cap) continue;
    if (cap.sideEffects === "write") hasWrite = true;
    // Heuristic: mass_dispatch, bridge, sniper, hedge are effectively irreversible.
    if (["mass_dispatch", "bridge", "deploy_sniper_bot", "hedge_position", "marketplace_publish"].includes(cap.id)) {
      hasIrreversible = true;
    }
  }
  if (hasIrreversible) return "irreversible";
  if (hasWrite) return "partial";
  return "reversible";
}

function riskScoreForSteps(steps: Plan["steps"]): number {
  const caps = listCapabilities();
  const byId = new Map(caps.map((c) => [c.id, c]));
  const scoreOf = { low: 0.15, medium: 0.5, high: 0.85 } as const;
  let max = 0;
  for (const s of steps) {
    const cap = byId.get(s.capabilityId);
    if (!cap) continue;
    max = Math.max(max, scoreOf[cap.sensitivity]);
  }
  return max;
}

function emptyPlan(reason: string, needsClarification: string[] = []): Plan {
  return {
    steps: [],
    rationale: reason,
    reversibility: "reversible",
    riskScore: 0,
    needsClarification: needsClarification.length ? needsClarification : undefined,
  };
}

const SYSTEM = `You are Dreyv's planner. Given a typed user Intent and the list
of available capabilities, produce a STRICT JSON Plan that uses ONLY the listed
capability ids.

Output schema:
{
  "steps": [ { "capabilityId": "<id>", "input": {<input matching that capability's schema>}, "rationale": "<short>" } ],
  "rationale": "<why this plan, 1-2 sentences>",
  "needsClarification": ["question1", ...] // if input is missing or ambiguous
}

Rules:
- NEVER invent a capability id. If nothing fits, return steps:[] with needsClarification.
- NEVER fabricate amounts, recipients, or addresses. If the user's intent omits a required field, ask via needsClarification.
- Prefer the smallest plan that satisfies intent. One step when possible.
- For "build" intent kind, use studio_init_miniapp.
- For "research" intent kind, use browser_research / risk_assessment / sentiment_analysis as appropriate.
- For multi-step ops (e.g. "swap then deposit"), order steps so each step's
  output can feed the next; the runtime will resolve split amounts.`;

async function callGroq(intent: Intent, catalog: string): Promise<Plan | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${SYSTEM}\n\nCAPABILITIES:\n${catalog}` },
          { role: "user", content: JSON.stringify(intent).slice(0, 6000) },
        ],
      }),
      signal: AbortSignal.timeout(9_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    return {
      steps: steps.map((s: any) => ({
        capabilityId: String(s.capabilityId || ""),
        input: s.input && typeof s.input === "object" ? s.input : {},
        rationale: s.rationale || undefined,
      })).filter((s: any) => s.capabilityId),
      rationale: parsed.rationale || "Synthesized via Groq.",
      reversibility: "reversible", // overwritten below
      riskScore: 0, // overwritten below
      needsClarification: Array.isArray(parsed.needsClarification) ? parsed.needsClarification : undefined,
    };
  } catch {
    return null;
  }
}

async function callGemini(intent: Intent, catalog: string): Promise<Plan | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `${SYSTEM}\n\nCAPABILITIES:\n${catalog}\n\nINTENT:\n${JSON.stringify(intent)}\n\nRespond with the JSON Plan only, no prose.`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    const parsed = JSON.parse(text);
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    return {
      steps: steps.map((s: any) => ({
        capabilityId: String(s.capabilityId || ""),
        input: s.input && typeof s.input === "object" ? s.input : {},
        rationale: s.rationale || undefined,
      })).filter((s: any) => s.capabilityId),
      rationale: parsed.rationale || "Synthesized via Gemini deep reasoning.",
      reversibility: "reversible",
      riskScore: 0,
      needsClarification: Array.isArray(parsed.needsClarification) ? parsed.needsClarification : undefined,
    };
  } catch {
    return null;
  }
}

function isComplexIntent(intent: Intent): boolean {
  if (intent.confidence < 0.5) return true;
  if ((intent.ambiguities?.length ?? 0) >= 2) return true;
  // Multi-verb requests like "swap then bridge then deposit"
  const verbCount = (intent.rawText.match(/\b(swap|bridge|deposit|stake|transfer|withdraw|rebalance)\b/gi) || []).length;
  return verbCount >= 2;
}

export async function synthesizePlan(intent: Intent): Promise<Plan> {
  if (intent.kind === "chitchat" || intent.kind === "unknown") {
    return emptyPlan(
      intent.kind === "chitchat" ? "Conversational input — no capability call." : "Intent unclear.",
      intent.ambiguities,
    );
  }

  const catalog = capabilityCatalogForLLM();
  const useDeep = isComplexIntent(intent);

  let plan: Plan | null = null;
  if (useDeep) plan = await callGemini(intent, catalog);
  if (!plan) plan = await callGroq(intent, catalog);

  if (!plan) {
    return emptyPlan("Planner unavailable; no LLM responded.", ["Planner could not produce a plan; please retry."]);
  }

  // Validate every step references a real capability.
  const knownIds = new Set(listCapabilities().map((c) => c.id));
  const validSteps = plan.steps.filter((s) => knownIds.has(s.capabilityId));
  const droppedCount = plan.steps.length - validSteps.length;

  const finalSteps = validSteps;
  const final: Plan = {
    steps: finalSteps,
    rationale: droppedCount
      ? `${plan.rationale} (Dropped ${droppedCount} step(s) referencing unknown capabilities.)`
      : plan.rationale,
    reversibility: reversibilityFromSideEffects(finalSteps),
    riskScore: riskScoreForSteps(finalSteps),
    needsClarification: plan.needsClarification,
  };
  return final;
}
