export const runtime = "edge";
/**
 * Alchemy Notify webhook receiver.
 *  - Verifies `X-Alchemy-Signature` HMAC SHA-256 against ALCHEMY_WEBHOOK_SIGNING_KEY.
 *  - Maps `ADDRESS_ACTIVITY` events into ChainEvent for ethereum/base/arbitrum/polygon/bsc.
 *  - Returns 200 fast.
 *
 * Configure in Alchemy Notify dashboard with this URL and the same signing key.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { publishDreyvEvent } from "@/lib/agents/bus";
import type { Chain, ChainEvent } from "@/lib/datafeeds/normalize";

export const dynamic = "force-dynamic";

const NETWORK_TO_CHAIN: Record<string, Chain> = {
  ETH_MAINNET: "ethereum",
  BASE_MAINNET: "base",
  ARB_MAINNET: "arbitrum",
  MATIC_MAINNET: "polygon",
  POLYGON_MAINNET: "polygon",
  BNB_MAINNET: "bsc",
};

function verifySignature(raw: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const mac = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  try {
    return timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY;
  if (secret) {
    const sig = req.headers.get("x-alchemy-signature");
    if (!verifySignature(raw, sig, secret)) {
      return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
    }
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const network = String(body?.event?.network || body?.network || "").toUpperCase();
  const chain = NETWORK_TO_CHAIN[network] || "ethereum";
  const activities: any[] = body?.event?.activity || [];
  const observedAt = new Date().toISOString();

  for (const a of activities) {
    const evt: ChainEvent = {
      kind: "chain",
      observedAt,
      source: "alchemy-webhook",
      correlationId: a?.hash || body?.id,
      chain,
      signatureOrHash: a?.hash || "unknown",
      walletAddress: a?.fromAddress || a?.toAddress,
      type:
        a?.category === "external" || a?.category === "internal"
          ? "transfer"
          : a?.category === "erc20"
            ? "transfer"
            : "unknown",
      amountUsd: typeof a?.value === "number" ? Number(a.value) : undefined,
      raw: a,
    };
    publishDreyvEvent(evt).catch(() => {});
  }

  return NextResponse.json({ ok: true, accepted: activities.length });
}

export function GET() {
  return NextResponse.json({ ok: true, route: "alchemy webhook receiver" });
}
