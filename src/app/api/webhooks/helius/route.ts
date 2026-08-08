export const runtime = "edge";
/**
 * Helius webhook receiver.
 *  - Verifies optional `Authorization` header against `HELIUS_WEBHOOK_AUTH`.
 *  - Normalizes each enhanced tx into a `ChainEvent` and publishes to the bus.
 *  - Always returns 200 fast so Helius doesn't retry on transient bus errors.
 *
 * Configure in Helius dashboard:
 *   URL:  https://<your-domain>/api/webhooks/helius
 *   Auth: header `Authorization: <secret>` matching HELIUS_WEBHOOK_AUTH
 */
import { NextRequest, NextResponse } from "next/server";
import { publish, publishDreyvEvent } from "@/lib/agents/bus";
import { surfaceChainOpportunity } from "@/lib/agents/opportunity-translator";
import type { ChainEvent } from "@/lib/datafeeds/normalize";
import { maybeDraftSniperBuy } from "@/lib/agents/dacs/sniper";
import type { HeliusEnhancedTx } from "@/lib/agents/artifacts/helius";

export const dynamic = "force-dynamic";

function classify(tx: any): ChainEvent["type"] {
  const t = String(tx?.type || "").toUpperCase();
  if (t.includes("SWAP")) return "swap";
  if (t.includes("STAKE") && !t.includes("UN")) return "stake";
  if (t.includes("UNSTAKE")) return "unstake";
  if (t.includes("TRANSFER")) return "transfer";
  if (t.includes("MINT")) return "mint";
  if (t.includes("BURN")) return "burn";
  if (t.includes("VOTE")) return "vote";
  return "unknown";
}

export async function POST(req: NextRequest) {
  const expected = process.env.HELIUS_WEBHOOK_AUTH;
  if (expected) {
    const got = req.headers.get("authorization") || "";
    if (got !== expected) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const items: any[] = Array.isArray(body) ? body : [body];
  const observedAt = new Date().toISOString();

  // Fire-and-forget publishing so Helius gets a fast 200.
  for (const tx of items) {
    const evt: ChainEvent = {
      kind: "chain",
      observedAt,
      source: "helius-webhook",
      correlationId: tx?.signature || tx?.transaction?.signatures?.[0],
      chain: "solana",
      signatureOrHash: tx?.signature || tx?.transaction?.signatures?.[0] || "unknown",
      walletAddress: tx?.feePayer || tx?.accountData?.[0]?.account,
      type: classify(tx),
      amountUsd: typeof tx?.amountUsd === "number" ? tx.amountUsd : undefined,
      raw: tx,
    };
    // Always publish raw chain event for downstream feeds + memory
    publishDreyvEvent(evt).catch(() => {});
    // Translate material events into agent.opportunity.surfaced for the brain router
    surfaceChainOpportunity(evt).catch(() => {});
  }

  // Phase 7B — fan out raw enhanced txs to the dedicated tx processor.
  // Capped at 200 to avoid blowing the Inngest fan-out budget on backfills.
  const slice = items.slice(0, 200);
  publish(
    slice.map((tx) => ({
      name: "wallet.tx.observed" as const,
      data: { source: "helius_webhook", tx },
    })),
  ).catch(() => {});

  // Phase 7E.1 — sniper bot match on inbound DEX tx (fire-and-forget).
  for (const tx of slice) {
    maybeDraftSniperBuy(tx as HeliusEnhancedTx).catch((e) =>
      console.warn("[helius webhook] sniper match failed:", e instanceof Error ? e.message : e),
    );
  }

  return NextResponse.json({ ok: true, accepted: items.length });
}

export function GET() {
  return NextResponse.json({ ok: true, route: "helius webhook receiver" });
}
