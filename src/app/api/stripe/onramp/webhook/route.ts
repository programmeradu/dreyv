import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/stripe/onramp/webhook
 * ───────────────────────────────
 * Receives `crypto.onramp_session.*` events from Stripe, verifies the
 * Stripe-Signature header with STRIPE_ONRAMP_WEBHOOK_SECRET, and optionally
 * forwards a compact summary to DREYV_ONRAMP_FORWARD_URL.
 *
 * Ported from the former Supabase edge function.
 */

export const dynamic = "force-dynamic";

async function verifySignature(payload: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=") as [string, string]),
  );
  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${payload}`));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_ONRAMP_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret missing" }, { status: 500 });
  }

  const payload = await req.text();
  const ok = await verifySignature(payload, req.headers.get("stripe-signature"), secret);
  if (!ok) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  console.log("[stripe/onramp/webhook]", event.type, event.id);

  if (typeof event.type === "string" && event.type.startsWith("crypto.onramp_session.")) {
    const session = event.data?.object ?? {};
    const forwardUrl = process.env.DREYV_ONRAMP_FORWARD_URL;
    if (forwardUrl) {
      try {
        await fetch(forwardUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: event.type,
            sessionId: session.id,
            status: session.status,
            walletAddresses: session.wallet_addresses,
            transactionDetails: session.transaction_details,
            metadata: session.metadata,
          }),
        });
      } catch (err) {
        console.error("[stripe/onramp/webhook] forward failed", err);
      }
    }
  }

  return NextResponse.json({ received: true });
}
