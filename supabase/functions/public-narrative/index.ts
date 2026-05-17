// Lovable AI edge function for the public /v/[address] explorer.
// Modes: "narrative" (1-paragraph wallet summary) or "suggestions"
// (3 concrete, data-grounded action ideas).
// All Lovable AI calls go through this edge function per project rule.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

interface FeaturePack {
  address: string;
  chain: "solana" | "ethereum" | "base" | "arbitrum" | "polygon" | "bsc";
  ageDays: number | null;
  totalUsd: number;
  composition: Array<{ symbol: string; pctUsd: number; usd: number }>;
  topProtocols: string[];
  delta30dPct: number | null;
  txCount30d: number;
  txCountPrev30d: number;
  isMultisig: boolean;
  signerCount: number;
  lastMeaningfulAction: { description: string; daysAgo: number } | null;
  archetype: string;
  idle: {
    solUiAmount: number;
    usdcUiAmount: number;
    emptyTokenAccounts: number;
  };
  topYields: Array<{ protocol: string; symbol: string; apy: number; riskTier: string }>;
}

const SYSTEM_NARRATIVE = `You are Dreyv's wallet narrator. Voice: calm, precise, founder-to-founder.
Write exactly ONE paragraph (60-90 words) describing the wallet using the supplied facts.
Open with the archetype + age. Then balance composition (one sentence).
Then a momentum/activity sentence. End with the last meaningful action if present.
Hard rules: NEVER invent numbers. NEVER use the words: revolutionize, game-changer, synergy, disrupt, next-gen, leverage, supercharge.
No emoji. No hashtags. No bullet points. No address strings. Plain prose.`;

const SYSTEM_SUGGESTIONS = `You are Dreyv's wallet advisor. Given the supplied facts, return STRICT JSON:
{"suggestions":[{"title":"...", "detail":"...", "intent":"stake|consolidate|yield|swap|hedge|stake_evm"}]}
Return 1 to 3 suggestions, ONLY ones the facts directly support. Skip any you cannot justify with the facts.
Each title <= 60 chars. Each detail <= 110 chars, with concrete numbers from the facts.
Voice: calm, founder-to-founder. Banned words: revolutionize, game-changer, synergy, disrupt, next-gen, leverage, supercharge.
If no suggestion is supported, return {"suggestions":[]}.`;

async function callLovableAI(system: string, user: string, json = false): Promise<string> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Lovable AI ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const j = await resp.json();
  return j?.choices?.[0]?.message?.content ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const mode: "narrative" | "suggestions" = body.mode === "suggestions" ? "suggestions" : "narrative";
    const pack: FeaturePack = body.featurePack;
    if (!pack || !pack.address) {
      return new Response(JSON.stringify({ error: "featurePack required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userMsg = JSON.stringify(pack);
    if (mode === "narrative") {
      const content = await callLovableAI(SYSTEM_NARRATIVE, userMsg, false);
      return new Response(JSON.stringify({ narrative: content.trim() }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      const raw = await callLovableAI(SYSTEM_SUGGESTIONS, userMsg, true);
      let parsed: { suggestions: Array<{ title: string; detail: string; intent: string }> } = { suggestions: [] };
      try {
        parsed = JSON.parse(raw);
      } catch {}
      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
