import { aiComplete, aiConfigured } from "@/lib/ai-gateway";

/**
 * Lightweight prompt categorizer using Lovable AI Gateway.
 * Falls back to keyword heuristics if no API key is present.
 */

export type PromptCategory =
  | "staking"
  | "swap"
  | "dao"
  | "nft"
  | "payments"
  | "analytics"
  | "social"
  | "other";

const KEYWORDS: Record<PromptCategory, RegExp> = {
  staking: /\b(stake|staking|msol|marinade|validator|yield|liquid stak)/i,
  swap: /\b(swap|trade|jupiter|aggregator|dex|route)/i,
  dao: /\b(dao|governance|vote|proposal|squads|multisig|treasury)/i,
  nft: /\b(nft|mint|collection|metaplex|magic eden|tensor)/i,
  payments: /\b(payment|payroll|invoice|stream|vest|streamflow|recurring)/i,
  analytics: /\b(dashboard|chart|analytics|metrics|portfolio|tracker)/i,
  social: /\b(chat|message|social|gated|feed|community)/i,
  other: /.*/,
};

export function categorizeByKeyword(prompt: string): PromptCategory {
  for (const [cat, re] of Object.entries(KEYWORDS) as [PromptCategory, RegExp][]) {
    if (cat === "other") continue;
    if (re.test(prompt)) return cat;
  }
  return "other";
}

/**
 * Use the unified AI gateway to tag the prompt category. Falls back to keyword heuristic.
 */
export async function categorizePrompt(prompt: string): Promise<PromptCategory> {
  if (!aiConfigured()) return categorizeByKeyword(prompt);

  const out = await aiComplete({
    messages: [
      {
        role: "system",
        content:
          "You categorize app-build prompts into one of: staking, swap, dao, nft, payments, analytics, social, other. Return ONLY the single category word, nothing else.",
      },
      { role: "user", content: prompt.slice(0, 500) },
    ],
    temperature: 0,
    timeoutMs: 15_000,
  });

  const raw = String(typeof out === "string" ? out : out ? JSON.stringify(out) : "").trim().toLowerCase();
  const valid: PromptCategory[] = [
    "staking", "swap", "dao", "nft", "payments", "analytics", "social", "other",
  ];
  return (valid.find((v) => raw.includes(v)) as PromptCategory) || categorizeByKeyword(prompt);
}
