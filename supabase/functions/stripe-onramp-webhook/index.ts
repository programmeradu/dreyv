// @ts-nocheck
// Stripe Crypto Onramp — webhook receiver.
// -----------------------------------------------------------------------------
// Listens for crypto onramp session lifecycle events and forwards a summary
// to the Dreyv app so it can refresh balances + log to agent_episodes.
//
// Verifies the Stripe-Signature header using STRIPE_ONRAMP_WEBHOOK_SECRET.
// Configure this URL in the Stripe dashboard under Developers → Webhooks,
// listening to `crypto.onramp_session.*` events.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "stripe-signature, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function verifySignature(
  payload: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
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
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${timestamp}.${payload}`),
  );
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Constant-time-ish compare
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const secret = Deno.env.get("STRIPE_ONRAMP_WEBHOOK_SECRET");
  if (!secret) {
    return new Response("Webhook secret missing", { status: 500, headers: corsHeaders });
  }

  const payload = await req.text();
  const ok = await verifySignature(payload, req.headers.get("stripe-signature"), secret);
  if (!ok) {
    return new Response("Invalid signature", { status: 400, headers: corsHeaders });
  }

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }

  // Log + (optionally) forward to the Dreyv app for vault refresh.
  console.log("[stripe-onramp-webhook]", event.type, event.id);

  if (event.type?.startsWith("crypto.onramp_session.")) {
    const session = event.data?.object ?? {};
    const forwardUrl = Deno.env.get("DREYV_ONRAMP_FORWARD_URL");
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
        console.error("[stripe-onramp-webhook] forward failed", err);
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
