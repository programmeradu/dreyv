import { NextRequest, NextResponse } from "next/server";
import { buildFeaturePack } from "@/lib/explorer/feature-pack";
import { checkPublicRateLimit } from "@/lib/public-rate-limit";
import { isValidSolanaAddress } from "@/lib/atlas-utils";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

import { createGroq } from "@ai-sdk/groq";
import { generateText } from "ai";

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY || "",
});

async function callLLM(mode: "narrative" | "suggestions", featurePack: any, edgeInsights: any[]) {
  if (!process.env.GROQ_API_KEY) return { error: "GROQ_API_KEY not configured on backend" };
  
  try {
    const { text } = await generateText({
      model: groq("llama-3.3-70b-versatile"),
      system: "You are a top-tier on-chain crypto forensics analyst. Your job is to analyze a Solana wallet based on its feature pack and edge insights, and provide a compelling, highly accurate, and concise narrative of what this wallet is doing. Output only the narrative text without any conversational filler.",
      prompt: `Analyze this wallet:\n\nFeature Pack:\n${JSON.stringify(featurePack, null, 2)}\n\nEdge Insights:\n${JSON.stringify(edgeInsights, null, 2)}\n\nProvide the ${mode}.`,
    });
    return { narrative: text };
  } catch (err) {
    return { error: `LLM error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function fetchEdgeInsights(address: string): Promise<unknown[]> {
  try {
    const r = await fetch(`${getSiteOrigin()}/api/public/edge-insights/${address}`, { cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j?.insights) ? j.insights : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const rl = checkPublicRateLimit(req, { bucket: "narrative", max: 20 });
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const [pack, edgeInsights] = await Promise.all([
    buildFeaturePack(address),
    fetchEdgeInsights(address),
  ]);
  const out = await callLLM("narrative", pack, edgeInsights);
  return NextResponse.json({ ...out, archetype: pack.archetype }, { headers: { "Cache-Control": "public, max-age=120" } });
}
