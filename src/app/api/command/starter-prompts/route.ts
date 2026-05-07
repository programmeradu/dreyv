import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You generate fresh starter prompts for Dryv, a Solana treasury copilot.
Voice: calm, precise, founder-to-founder. No emojis. No hype words.
Focus exclusively on these themes (per partner feedback):
  - cost reduction (fees, slippage, routing)
  - yield (idle stables, LSTs, comparing protocols by APY/TVL/risk)
  - risk (drift, concentration, runway, anomalies)
Return STRICT JSON only:
{ "prompts": [ { "label": "<2-4 word verb phrase>", "text": "<full prompt, 6-14 words, no trailing punctuation>", "pillar": "fees" | "yield" | "risk" } ] }
Exactly 5 prompts. Vary them every call. Never repeat phrasing across the 5. No "swap X to Y" demos. No made-up dollar amounts.`;

export async function GET(req: NextRequest) {
  const lovableUrl = process.env.LOVABLE_SUPABASE_URL || process.env.LOVABLE_AI_PROXY_SUPABASE_URL;
  const lovableAnon = process.env.LOVABLE_SUPABASE_ANON_KEY || process.env.LOVABLE_SUPABASE_PUBLISHABLE_KEY;
  const proxyUrlExplicit = process.env.LOVABLE_AI_PROXY_URL;
  const supabaseUrl = lovableUrl || (!proxyUrlExplicit ? (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL) : undefined);
  const supabaseAnon = lovableAnon || (!proxyUrlExplicit ? (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY
  ) : undefined);
  const proxyUrl = proxyUrlExplicit
    ? proxyUrlExplicit.replace(/\/+$/, "")
    : (supabaseUrl ? `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/lovable-ai-proxy` : null);

  if (!proxyUrl || !supabaseAnon) {
    return Response.json({ error: "ai_gateway_not_configured" }, { status: 503 });
  }

  const seed = Math.random().toString(36).slice(2, 10);
  const upstream = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseAnon}`,
      apikey: supabaseAnon,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      stream: false,
      temperature: 0.95,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Generate 5 fresh, distinct starter prompts. Variation seed: ${seed}. Mix the pillars (at least one of each: fees, yield, risk).` },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!upstream.ok) {
    return Response.json({ error: "ai_gateway_error", status: upstream.status }, { status: 502 });
  }

  const data = await upstream.json().catch(() => null) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return Response.json({ error: "no_content" }, { status: 502 });

  let parsed: any;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    return Response.json({ error: "parse_error" }, { status: 502 });
  }

  const prompts = Array.isArray(parsed?.prompts) ? parsed.prompts.slice(0, 5) : [];
  if (prompts.length === 0) return Response.json({ error: "empty_prompts" }, { status: 502 });

  return Response.json(
    { prompts },
    { headers: { "Cache-Control": "no-store" } },
  );
}
