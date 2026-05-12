import { NextRequest, NextResponse } from "next/server";
import { lovableJson } from "@/lib/lovable-ai-proxy";

/**
 * Public landing-page command parser.
 *
 * Wraps the Atlas LLM parser with:
 *  - An extended manifest (audit_token, find_airdrops, what_if, build_mini_app,
 *    create_dca, build_agent, find_arbitrage) tailored to the marketing demo.
 *  - In-memory LRU cache so repeat visitors / typewriter examples don't re-hit the LLM.
 *  - Aggressive regex fallback so a degraded LLM still produces a useful result.
 *
 * No auth, no wallet writes. Pure intent → structured tool call.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CACHE = new Map<string, { value: any; expires: number }>();
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 min
const CACHE_MAX = 200;

function cacheGet(key: string) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    CACHE.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key: string, value: any) {
  if (CACHE.size >= CACHE_MAX) {
    const firstKey = CACHE.keys().next().value;
    if (firstKey) CACHE.delete(firstKey);
  }
  CACHE.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

const HOME_MANIFEST = `
[
  { "tool_id": "swap_tokens", "params": { "input_token": "SOL|USDC|JUP|BONK|...", "output_token": "...", "amount": "number" } },
  { "tool_id": "stake_sol", "params": { "provider": "marinade|jito|blazestake", "amount": "number" } },
  { "tool_id": "rebalance", "params": { "targets": "{ SYMBOL: percent } e.g. {\\"SOL\\":60,\\"USDC\\":30,\\"JTO\\":10}" } },
  { "tool_id": "price_check", "params": { "token": "symbol" } },
  { "tool_id": "market_overview", "params": {} },
  { "tool_id": "scan_mev", "params": {} },
  { "tool_id": "find_arbitrage", "params": { "min_profit": "number percent" } },
  { "tool_id": "audit_token", "params": { "token": "symbol or mint" } },
  { "tool_id": "find_airdrops", "params": { "wallet": "optional address" } },
  { "tool_id": "what_if", "params": { "scenario": "free text e.g. SOL drops 40%" } },
  { "tool_id": "create_dca", "params": { "in_token": "USDC", "out_token": "SOL", "amount": "number", "frequency": "daily|weekly|monthly" } },
  { "tool_id": "build_mini_app", "params": { "idea": "free text describing the mini app" } },
  { "tool_id": "build_agent", "params": { "kind": "trading|investment|treasury", "rules": "free text" } },
  { "tool_id": "yield_overview", "params": {} },
  { "tool_id": "show_portfolio", "params": {} },
  { "tool_id": "clarify", "params": { "question": "the follow-up question to ask the user", "suggested_replies": ["short option 1", "short option 2", "short option 3"], "for_tool": "the tool_id we'll run once they answer" } },
  { "tool_id": "unknown", "params": {} }
]
`.trim();

const SYSTEM_PROMPT = `You are the intent parser for Dreyv's public command bar. Convert one short natural-language command into a single JSON object: { "tool_id": "...", "parameters": { ... } }. Use ONLY tool_ids from the manifest. Return JSON only, no prose, no code fences.

Rules:
- Token symbols ALWAYS uppercase (SOL, USDC, JUP, BONK, JTO, MSOL, JITOSOL, etc.).
- Amounts are plain numbers, not lamports.
- "rebalance" / "rebalance treasury 60/30/10" => tool_id rebalance with parameters.targets as a {SYMBOL:percent} object.
- "audit", "is X safe", "rug check" => audit_token.
- "airdrops on my wallet", "find airdrops" => find_airdrops.
- "what if SOL drops 40%", "runway if" => what_if with scenario as free text.
- "build a mini app", "make a swap widget" => build_mini_app.
- "build a dca bot", "dca 100 usdc into sol weekly" => create_dca.
- "build a trading agent" / "investment agent" => build_agent.
- "arbitrage opportunities", "find arb" => find_arbitrage.
- "trending", "market pulse" => market_overview.
- CLARIFY when the user's intent is clear but a required figure or token is missing or ambiguous (e.g. "swap SOL to USDC" with no amount, "build a dca bot" with no token/amount/cadence, "rebalance" with no targets, "what if" with no concrete % or asset). Return tool_id "clarify" with a SHORT, specific question and 2-4 suggested_replies that, if appended to the original command, would make it executable. Always include "for_tool" so the next turn knows what to run.
- Do NOT clarify if reasonable defaults exist AND the user gave at least one concrete number — just run it.
- If unsure, tool_id = "unknown".`;

const TOKEN_RE = /\b(SOL|USDC|USDT|JUP|BONK|JTO|MSOL|JITOSOL|BSOL|WIF|PYTH|RAY|ORCA|DRIFT|TNSR|MNDE)\b/gi;

function regexFallback(text: string): { tool_id: string; parameters: Record<string, any> } {
  const t = text.toLowerCase().trim();
  const upper = text.toUpperCase();
  const tokens = Array.from(upper.matchAll(TOKEN_RE)).map((m) => m[0]);
  const amtMatch = t.match(/(\d+(?:\.\d+)?)/);
  const amount = amtMatch ? Number(amtMatch[1]) : undefined;

  if (/\b(rebalance|allocation|allocate)\b/.test(t)) {
    const targets: Record<string, number> = {};
    for (const m of t.matchAll(/(\d+)\s*%\s*([a-z]{2,8})/g)) {
      targets[m[2].toUpperCase()] = Number(m[1]);
    }
    return { tool_id: "rebalance", parameters: { targets: Object.keys(targets).length ? targets : { SOL: 60, USDC: 30, JTO: 10 } } };
  }
  if (/\b(swap|buy|sell|convert|trade)\b/.test(t)) {
    const swap = t.match(/(\d+(?:\.\d+)?)\s*([a-z]{2,8})\s*(?:to|for|into|→|->)\s*([a-z]{2,8})/i);
    if (swap) return { tool_id: "swap_tokens", parameters: { amount: Number(swap[1]), input_token: swap[2].toUpperCase(), output_token: swap[3].toUpperCase() } };
    return { tool_id: "swap_tokens", parameters: { amount, input_token: tokens[0] || "SOL", output_token: tokens[1] || "USDC" } };
  }
  if (/\b(stake|staking)\b/.test(t)) {
    const provider = /jito/.test(t) ? "jito" : /blaze/.test(t) ? "blazestake" : "marinade";
    return { tool_id: "stake_sol", parameters: { provider, amount } };
  }
  if (/\b(dca|dollar.cost|recurring)\b/.test(t)) {
    const freq = /weekly/.test(t) ? "weekly" : /monthly/.test(t) ? "monthly" : "daily";
    return { tool_id: "create_dca", parameters: { in_token: tokens[0] || "USDC", out_token: tokens[1] || "SOL", amount, frequency: freq } };
  }
  if (/\b(arbitrage|arb opportunit)/.test(t)) return { tool_id: "find_arbitrage", parameters: { min_profit: 0.5 } };
  if (/\bmev\b/.test(t)) return { tool_id: "scan_mev", parameters: {} };
  if (/\b(rug|audit|safe)\b/.test(t)) return { tool_id: "audit_token", parameters: { token: tokens[0] || "BONK" } };
  if (/\bairdrop/.test(t)) return { tool_id: "find_airdrops", parameters: {} };
  if (/\bwhat\s*if\b|runway/.test(t)) return { tool_id: "what_if", parameters: { scenario: text } };
  if (/\b(mini.?app|widget|blink)\b/.test(t)) return { tool_id: "build_mini_app", parameters: { idea: text } };
  if (/\b(agent|bot)\b.*\b(trad|invest|treasury)/.test(t) || /build.*\bagent\b/.test(t))
    return { tool_id: "build_agent", parameters: { kind: /invest/.test(t) ? "investment" : /treasury/.test(t) ? "treasury" : "trading", rules: text } };
  if (/\b(price|how much is|cost of)\b/.test(t)) return { tool_id: "price_check", parameters: { token: tokens[0] || "SOL" } };
  if (/\b(trending|market|pulse|overview)\b/.test(t)) return { tool_id: "market_overview", parameters: {} };
  if (/\b(yield|apy|stak.*best)\b/.test(t)) return { tool_id: "yield_overview", parameters: {} };
  if (/\b(portfolio|balance|holdings)\b/.test(t)) return { tool_id: "show_portfolio", parameters: {} };

  return { tool_id: "unknown", parameters: {} };
}

async function callLovableAI(prompt: string, system: string) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) {
      console.warn("[home/parse] gateway", res.status);
      return null;
    }
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content;
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    console.warn("[home/parse] LLM error", e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }
    const trimmed = text.trim().slice(0, 280);
    const cacheKey = trimmed.toLowerCase();
    const cached = cacheGet(cacheKey);
    if (cached) return NextResponse.json({ ...cached, cached: true });

    const prompt = `User command: "${trimmed}"\n\nManifest:\n${HOME_MANIFEST}\n\nReturn one JSON object now.`;
    let parsed = await callLovableAI(prompt, SYSTEM_PROMPT);
    if (!parsed || !parsed.tool_id || parsed.tool_id === "unknown") {
      parsed = regexFallback(trimmed);
    }
    if (!parsed.parameters) parsed.parameters = {};
    cacheSet(cacheKey, parsed);
    return NextResponse.json(parsed);
  } catch (e: any) {
    return NextResponse.json({ tool_id: "unknown", parameters: {}, error: e?.message }, { status: 200 });
  }
}
