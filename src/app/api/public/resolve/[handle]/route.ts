export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";
import { detectAddressKind } from "@/lib/explorer/chain";
import { checkPublicRateLimit } from "@/lib/public-rate-limit";

export const dynamic = "force-dynamic";

// SNS (.sol) → owner via Bonfida free resolver
async function resolveSns(name: string): Promise<string | null> {
  try {
    const r = await fetch(`https://sns-sdk-proxy.bonfida.workers.dev/resolve/${name.replace(/\.sol$/, "")}`);
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.result === "string" ? j.result : null;
  } catch {
    return null;
  }
}

// ENS (.eth) → owner via free Cloudflare gateway
async function resolveEns(name: string): Promise<string | null> {
  try {
    const r = await fetch(`https://cloudflare-eth.com/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          {
            to: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e", // ENS Registry
            data: "0x0178b8bf" + name.padEnd(64, "0"), // naive — fallback to address services instead
          },
          "latest",
        ],
      }),
    });
    if (!r.ok) return null;
    // Fallback to public ENS Ideas API for reliable name → address
    const ideas = await fetch(`https://api.ensideas.com/ens/resolve/${name}`);
    if (!ideas.ok) return null;
    const j = await ideas.json();
    return typeof j?.address === "string" ? j.address : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const rl = checkPublicRateLimit(req, { bucket: "resolve", max: 30 });
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const kind = detectAddressKind(handle);
  if (kind === "handle-sol") {
    const a = await resolveSns(handle);
    return a ? NextResponse.json({ address: a, chain: "solana" }) : NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (kind === "handle-eth") {
    const a = await resolveEns(handle);
    return a ? NextResponse.json({ address: a, chain: "evm" }) : NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ error: "invalid_handle" }, { status: 400 });
}
