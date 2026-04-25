/**
 * DACS Phase 1 — Intent extraction.
 *
 * Single-call Groq llama-3.3 classifier. Returns a typed `Intent` describing
 * what the user wants in capability-aware terms (kind, entities, constraints,
 * confidence, ambiguities). Falls back to a regex heuristic when GROQ is
 * unavailable so the pipeline still flows in dev / shadow mode.
 *
 * The planner consumes this directly; route.ts (legacy) does NOT.
 */

import type { Intent, IntentKind } from "./types";

const SYSTEM = `You are Dreyv's intent classifier. The user just submitted a
command to a treasury agent. Respond with STRICT JSON ONLY:

{
  "kind": "<one of: treasury_action|trade|yield_action|research|build|monitor|policy_setup|payment|risk_check|navigate|chitchat|unknown>",
  "entities": { "token"?: string, "amount"?: number, "recipient"?: string, "protocol"?: string, "chain"?: string, "appId"?: string, "url"?: string, "symbol"?: string, ... },
  "constraints": { "slippageMaxPct"?: number, "deadline"?: string, "modeFlag"?: "build"|"execute"|"auto", ... },
  "confidence": 0..1,
  "ambiguities": ["clarifying question"]
}

Rules:
- Be conservative. Default to "unknown" + ambiguities[] when unsure.
- "treasury_action" = transfer/multisig/mass_dispatch.
- "trade" = swap/bridge/sniper.
- "yield_action" = stake/deposit/withdraw/rebalance/dca.
- "research" = price/risk/sdk/idl/sentiment/browser questions.
- "build" = scaffold mini-app, write code, studio.
- "monitor" = set alert / watch token / autopilot.
- "policy_setup" = define guardrails, runway floor, allowlists.
- "payment" = recurring/invoice/grant/gas-tank.
- "risk_check" = counterparty score, liquidation watch, attestation.
- "navigate" = "open settings", "go to studio".
- Numbers: extract literal amounts (e.g. "0.5 SOL" → token: "SOL", amount: 0.5).
- Never invent values. If user said "swap some SOL", omit amount and add ambiguity.`;

const REGEX_HINTS: Array<{ kind: IntentKind; re: RegExp }> = [
  { kind: "trade", re: /\b(swap|bridge|snipe)\b/i },
  { kind: "yield_action", re: /\b(stake|unstake|deposit|withdraw|rebalance|dca)\b/i },
  { kind: "treasury_action", re: /\b(transfer|send|payroll|mass.?dispatch|multisig)\b/i },
  { kind: "build", re: /\b(build|create|scaffold|init|generate)\b.*\b(app|bot|mini.?app|script|widget)\b/i },
  { kind: "monitor", re: /\b(monitor|alert|watch|notify when)\b/i },
  { kind: "policy_setup", re: /\b(policy|guardrail|allowlist|denylist|runway floor|autopilot)\b/i },
  { kind: "payment", re: /\b(invoice|grant|payroll|recurring|gas tank|top.?up)\b/i },
  { kind: "risk_check", re: /\b(risk score|counterparty|liquidation|attestation|proof of reserves)\b/i },
  { kind: "research", re: /\b(price|apy|risk|audit|sdk|idl|sentiment|tvl|why)\b/i },
  { kind: "navigate", re: /\b(open|go to|navigate)\b/i },
];

function regexFallback(text: string): Intent {
  for (const { kind, re } of REGEX_HINTS) {
    if (re.test(text)) {
      return {
        kind,
        entities: {},
        constraints: {},
        confidence: 0.35,
        ambiguities: ["Heuristic classification; entities not extracted."],
        rawText: text,
      };
    }
  }
  return {
    kind: "unknown",
    entities: {},
    constraints: {},
    confidence: 0.1,
    ambiguities: ["Could not classify intent from text."],
    rawText: text,
  };
}

export async function classifyIntent(rawText: string): Promise<Intent> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return regexFallback(rawText);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: rawText.slice(0, 4000) },
        ],
      }),
      signal: AbortSignal.timeout(7_000),
    });
    if (!res.ok) return regexFallback(rawText);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return regexFallback(rawText);
    const parsed = JSON.parse(content);
    return {
      kind: parsed.kind || "unknown",
      entities: parsed.entities || {},
      constraints: parsed.constraints || {},
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      ambiguities: Array.isArray(parsed.ambiguities) ? parsed.ambiguities : [],
      rawText,
    };
  } catch {
    return regexFallback(rawText);
  }
}
