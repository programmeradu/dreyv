/**
 * POST /api/acp/checkout — ACP "checkout" capability.
 *
 * Auth: Bearer (dk_live_… or OAuth JWT) — agent must already exist.
 *
 * Body:
 *   {
 *     tier: "mini" | "max",
 *     payment: { provider: "stripe" | "paystack" | "x402", ... }
 *   }
 *
 * Behavior:
 *   - stripe   → returns hosted Stripe Checkout URL (user/agent finishes there;
 *                tier flips when /api/stripe/webhook fires).
 *   - paystack → same pattern with Paystack.
 *   - x402     → if no X-PAYMENT header, returns 402 with `accepts`. With a
 *                valid payment, immediately calls upgradeUserTier and returns
 *                the new tier — the only fully-agentic rail.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { upgradeUserTier, type Tier } from "@/lib/agent/tier-upgrade";
import { verifyX402Payment, type X402Requirements } from "@/lib/agent/x402-verify";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIER_PRICE_USDC_ATOMIC: Record<Exclude<Tier, "free">, string> = {
  mini: "49000000", // $49.00 USDC = 49 * 1e6
  max: "199000000", // $199.00 USDC
};

const RECEIVER = process.env.X402_PAY_TO?.trim() || "0x0000000000000000000000000000000000000000";
const ASSET = process.env.X402_ASSET?.trim() || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const NETWORK = process.env.X402_NETWORK?.trim() || "base-sepolia";

export async function POST(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  let body: {
    tier?: Tier;
    payment?: {
      provider?: "stripe" | "paystack" | "x402";
      email?: string;
    };
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const tier = body.tier;
  if (tier !== "mini" && tier !== "max") {
    return NextResponse.json({ error: "invalid_tier", expected: ["mini", "max"] }, { status: 400 });
  }
  const provider = body.payment?.provider ?? "x402";
  const origin = getSiteOrigin();

  // ─── x402: fully agentic ─────────────────────────────────────────────
  if (provider === "x402") {
    const resource = `${origin}/api/acp/checkout`;
    const requirements: X402Requirements = {
      scheme: "exact",
      network: NETWORK,
      maxAmountRequired: TIER_PRICE_USDC_ATOMIC[tier],
      resource,
      payTo: RECEIVER,
      asset: ASSET,
      description: `Dreyv ${tier} — 1 month`,
      mimeType: "application/json",
      maxTimeoutSeconds: 120,
      extra: { name: "USDC", version: "2" },
    };
    const header = req.headers.get("x-payment");
    const receipt = req.headers.get("x-payment-receipt");
    const testModeAllowed = process.env.X402_ALLOW_TEST_MODE !== "false";
    const isTest = testModeAllowed && (header === "test" || header === "sandbox");

    if (!header && !receipt) {
      const humanCheckoutUrl = `${origin}/app/billing?tier=${tier}&via=x402`;
      const costUsd = tier === "mini" ? "49.00" : "199.00";
      return NextResponse.json(
        {
          // ── Agent-friendly top-level (deterministic, single-step) ──
          error: "payment_required",
          cost: costUsd,
          currency: "USDC",
          network: NETWORK,
          payTo: RECEIVER,
          asset: ASSET,
          human_checkout_url: humanCheckoutUrl,
          instructions: testModeAllowed
            ? `Autonomous: send ${costUsd} USDC (${TIER_PRICE_USDC_ATOMIC[tier]} atomic) on ${NETWORK} to ${RECEIVER}, then replay this request with header 'X-Payment-Receipt: <tx_hash>' (or x402 EIP-3009 payload via 'X-PAYMENT'). Sandbox: replay with 'X-PAYMENT: test'. Human fallback: open human_checkout_url.`
            : `Autonomous: send ${costUsd} USDC (${TIER_PRICE_USDC_ATOMIC[tier]} atomic) on ${NETWORK} to ${RECEIVER}, then replay this request with header 'X-Payment-Receipt: <tx_hash>' (or x402 EIP-3009 payload via 'X-PAYMENT'). Human fallback: open human_checkout_url.`,
          // ── x402 spec compliance ──
          x402Version: 1,
          accepts: [requirements],
          documentation: `${origin}/.well-known/x402`,
        },
        {
          status: 402,
          headers: {
            "WWW-Authenticate": `x402 resource="${resource}", scheme="exact", network="${NETWORK}"`,
            Link: `<${origin}/.well-known/x402>; rel="payment-discovery"; type="application/json"`,
            "X-Payment-Required": "true",
            "X-X402-Version": "1",
          },
        },
      );
    }

    let payer: string | undefined;
    let txHash: string | null = null;
    if (isTest) {
      payer = "test-mode";
    } else {
      const result = await verifyX402Payment(header, requirements);
      if (!result.ok) {
        return NextResponse.json(
          { x402Version: 1, error: "payment_invalid", reason: result.reason, accepts: [requirements] },
          { status: 402 },
        );
      }
      payer = result.payer;
      txHash = result.txHash ?? null;
    }
    const expires = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    await upgradeUserTier(key.userId, tier, expires);
    return NextResponse.json({
      ok: true,
      tier,
      expires_at: expires.toISOString(),
      payer,
      tx_hash: txHash,
      mode: isTest ? "test" : "live",
    });
  }

  // For stripe/paystack we need an email on file.
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, key.userId))
    .limit(1);
  const email = (body.payment?.email ?? row?.email ?? "").trim();
  if (!email) {
    return NextResponse.json(
      {
        error: "email_required",
        hint: "Add an email to the agent's profile, or pass payment.email — Stripe/Paystack require it.",
      },
      { status: 422 },
    );
  }

  // ─── Stripe ──────────────────────────────────────────────────────────
  if (provider === "stripe") {
    const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
    const priceId = tier === "mini"
      ? process.env.STRIPE_PRICE_ID_MINI?.trim()
      : process.env.STRIPE_PRICE_ID_MAX?.trim();
    if (!stripeKey || !priceId) {
      return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
    }
    const form = new URLSearchParams();
    form.set("mode", "subscription");
    form.set("customer_email", email);
    form.set("line_items[0][price]", priceId);
    form.set("line_items[0][quantity]", "1");
    form.set("success_url", `${origin}/app/billing?stripe=success&session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${origin}/app/billing?stripe=cancel`);
    form.set("metadata[dreyv_user_id]", key.userId);
    form.set("metadata[tier]", tier);
    form.set("metadata[source]", "acp_checkout");
    form.set("subscription_data[metadata][dreyv_user_id]", key.userId);
    form.set("subscription_data[metadata][tier]", tier);
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const data = (await res.json()) as { url?: string; id?: string; error?: { message?: string } };
    if (!res.ok || !data.url) {
      return NextResponse.json(
        { error: "stripe_failed", detail: data.error?.message ?? "unknown" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      provider: "stripe",
      checkout_url: data.url,
      session_id: data.id,
      requires_human_step: true,
      note: "Open checkout_url to complete payment. Tier flips on webhook receipt.",
    });
  }

  // ─── Paystack ────────────────────────────────────────────────────────
  if (provider === "paystack") {
    const { getPaystackSecret, paystackInitializeTransaction, planCodeForTier } =
      await import("@/lib/paystack");
    try {
      getPaystackSecret();
    } catch {
      return NextResponse.json({ error: "paystack_not_configured" }, { status: 503 });
    }
    const plan = planCodeForTier(tier);
    if (!plan) return NextResponse.json({ error: "paystack_plan_missing" }, { status: 503 });
    const session = await paystackInitializeTransaction({
      email,
      plan,
      callbackUrl: `${origin}/app/billing?paystack=verify`,
      metadata: { dreyv_user_id: key.userId, tier, source: "acp_checkout" },
    });
    return NextResponse.json({
      ok: true,
      provider: "paystack",
      checkout_url: session.authorization_url,
      reference: session.reference,
      requires_human_step: true,
    });
  }

  return NextResponse.json(
    { error: "unsupported_provider", supported: ["x402", "stripe", "paystack"] },
    { status: 400 },
  );
}
