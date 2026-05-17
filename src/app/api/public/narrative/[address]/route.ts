import { NextRequest, NextResponse } from "next/server";
import { buildFeaturePack } from "@/lib/explorer/feature-pack";
import { checkPublicRateLimit } from "@/lib/public-rate-limit";
import { isValidSolanaAddress } from "@/lib/atlas-utils";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function callEdge(mode: "narrative" | "suggestions", featurePack: unknown) {
  if (!SUPABASE_URL || !ANON) return { error: "edge function not configured" };
  const r = await fetch(`${SUPABASE_URL}/functions/v1/public-narrative`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({ mode, featurePack }),
  });
  if (!r.ok) return { error: `edge ${r.status}` };
  return await r.json();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const rl = checkPublicRateLimit(req, { bucket: "narrative", max: 20 });
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const pack = await buildFeaturePack(address);
  const out = await callEdge("narrative", pack);
  return NextResponse.json({ ...out, archetype: pack.archetype }, { headers: { "Cache-Control": "public, max-age=120" } });
}
