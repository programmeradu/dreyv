/**
 * POST /api/agents/balance/topup — fund the agent's prepaid balance.
 *
 * Auth: Bearer (dk_live_… or OAuth JWT).
 *
 * Body:
 *   {
 *     amount_usd: number,                         // 5..10_000
 *     provider?: "x402" | "stripe"               // default "x402"
 *   }
 *
 * Behavior:
 *   - x402 (default, fully agentic): same lifecycle as /api/acp/checkout.
 *     First call without X-Payment-Receipt/X-PAYMENT returns 402 with the
 *     deterministic top-level shape (cost/currency/network/payTo/instructions).
 *     Replay with `X-Payment-Receipt: <tx_hash>` (autonomous) or
 *     `X-PAYMENT: <eip3009>` to settle. Credits balance idempotently.
 *   - stripe: returns a hosted one-time Checkout URL the operator opens.
 *     Webhook (metadata.source = "balance_topup") credits the balance.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { creditAgentBalance, getAgentBalance, minorToUsd, usdToMinor, TOPUP_MIN_USD, TOPUP_MAX_USD } from "@/lib/agent/balance";
import { verifyX402Payment, type X402Requirements } from "@/lib/agent/x402-verify";
import { getSiteOrigin } from "@/lib/seo/site";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { buildPaymentOptions } from "@/lib/agent/payment-options";
import { getOrCreateAgentWallet } from "@/lib/agent/wallet";
import { tokenFor } from "@/lib/billing/crypto-config";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const RECEIVER = process.env.X402_PAY_TO?.trim() || "0x0000000000000000000000000000000000000000";
const ASSET = process.env.X402_ASSET?.trim() || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const NETWORK = process.env.X402_NETWORK?.trim() || "base-sepolia";

export async function POST(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  let body: { amount_usd?: number; provider?: "x402" | "stripe" | "paystack" | "list" } = {};
  try { body = await req.json(); } catch { /* allow empty for x402 replay */ }

  const amountUsd = Number(body.amount_usd);
  const amountValid = Number.isFinite(amountUsd) && amountUsd >= TOPUP_MIN_USD && amountUsd <= TOPUP_MAX_USD;
  const provider = body.provider ?? (amountValid ? "x402" : "list");
  const origin = getSiteOrigin();

  // ─── list: enumerate every payment option for the human to choose ────
  if (provider === "list") {
    const amt = amountValid ? amountUsd : TOPUP_MIN_USD;
    const { getWalletBalances } = await import("@/lib/agent/wallet");
    let walletAddress: string | null = null;
    let walletUsdcMinor: bigint = BigInt(0);
    const usdc = tokenFor("solana", "usdc");
    try {
      const w = await getOrCreateAgentWallet(key.userId);
      walletAddress = w.publicKey;
      if (usdc?.contract) {
        const b = await getWalletBalances({ publicKey: w.publicKey, mintAddress: usdc.contract });
        walletUsdcMinor = b.tokenMinor;
      }
    } catch { /* non-fatal */ }

    const current = await getAgentBalance(key.userId);
    const autonomousReady = current.balance_minor > BigInt(0) || walletUsdcMinor > BigInt(0);

    if (autonomousReady) {
      return NextResponse.json({
        ok: true,
        autonomous_ready: true,
        amount_usd: amt,
        currency: "USDC",
        funded_rails: {
          prepaid_balance_minor: current.balance_minor.toString(),
          wallet_usdc_minor: walletUsdcMinor.toString(),
          wallet_address: walletAddress,
        },
        note: "Already funded — settle capabilities autonomously (prepaid charge or x402 from wallet). Do NOT prompt the human.",
      });
    }

    const menu = buildPaymentOptions({
      origin,
      amountUsd: amt,
      walletAddress,
      walletUsdcMint: usdc?.contract ?? null,
      network: process.env.X402_NETWORK?.trim() || "base-sepolia",
      stripeEnabled: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
      paystackEnabled: Boolean(process.env.PAYSTACK_SECRET_KEY?.trim()),
    });
    return NextResponse.json({
      ok: true,
      autonomous_ready: false,
      amount_usd: amt,
      currency: "USDC",
      ...menu,
      note: "Call this endpoint again with one of options[].body to execute the chosen rail.",
    });
  }


  if (!amountValid) {
    return NextResponse.json(
      { error: "invalid_amount", min_usd: TOPUP_MIN_USD, max_usd: TOPUP_MAX_USD },
      { status: 400 },
    );
  }
  const amountMinor = usdToMinor(amountUsd);
  const amountAtomicUsdc = amountMinor.toString(); // USDC also 6 decimals on Base/Solana

  // ─── x402 ────────────────────────────────────────────────────────────
  if (provider === "x402") {
    const resource = `${origin}/api/agents/balance/topup`;
    const requirements: X402Requirements = {
      scheme: "exact",
      network: NETWORK,
      maxAmountRequired: amountAtomicUsdc,
      resource,
      payTo: RECEIVER,
      asset: ASSET,
      description: `Dreyv balance top-up — $${amountUsd.toFixed(2)} USDC`,
      mimeType: "application/json",
      maxTimeoutSeconds: 120,
      extra: { name: "USDC", version: "2" },
    };
    const header = req.headers.get("x-payment");
    const receipt = req.headers.get("x-payment-receipt");
    // Sandbox header credits balance without on-chain settlement. MUST be
    // explicit opt-in: default OFF in production so a leaked dk_live_ key
    // can't mint unlimited prepaid USDC by replaying `X-PAYMENT: test`.
    const testModeAllowed =
      process.env.X402_ALLOW_TEST_MODE === "true" ||
      (process.env.NODE_ENV !== "production" && process.env.X402_ALLOW_TEST_MODE !== "false");
    const isTest = testModeAllowed && (header === "test" || header === "sandbox");

    if (!header && !receipt) {
      const humanCheckoutUrl = `${origin}/app/billing?topup=${amountUsd}&via=x402`;
      return NextResponse.json(
        {
          error: "payment_required",
          cost: amountUsd.toFixed(2),
          currency: "USDC",
          network: NETWORK,
          payTo: RECEIVER,
          asset: ASSET,
          human_checkout_url: humanCheckoutUrl,
          instructions: `Autonomous: send ${amountUsd.toFixed(2)} USDC (${amountAtomicUsdc} atomic) on ${NETWORK} to ${RECEIVER}, then replay POST ${resource} with header 'X-Payment-Receipt: <tx_hash>'.${testModeAllowed ? " Sandbox: replay with 'X-PAYMENT: test'." : ""} Human fallback: open human_checkout_url.`,
          x402Version: 1,
          accepts: [requirements],
          documentation: `${origin}/.well-known/x402`,
        },
        {
          status: 402,
          headers: {
            "WWW-Authenticate": `x402 resource="${resource}", scheme="exact", network="${NETWORK}"`,
            "X-Payment-Required": "true",
            "X-X402-Version": "1",
          },
        },
      );
    }

    let ref: string;
    if (isTest) {
      ref = `test:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    } else if (receipt && !header) {
      const result = await verifyX402Payment(`receipt:${receipt}`, requirements);
      if (!result.ok) {
        return NextResponse.json(
          { error: "payment_invalid", reason: result.reason, tx_hash: receipt, accepts: [requirements] },
          { status: 402 },
        );
      }
      ref = receipt;
    } else {
      const result = await verifyX402Payment(header ?? "", requirements);
      if (!result.ok) {
        return NextResponse.json(
          { error: "payment_invalid", reason: result.reason, accepts: [requirements] },
          { status: 402 },
        );
      }
      ref = result.txHash ?? `x402:${Date.now()}`;
    }

    const credit = await creditAgentBalance({
      userId: key.userId,
      amountMinor,
      reason: "topup_x402",
      ref,
    });
    if (!credit.ok) {
      // Duplicate ref — already credited. Return current balance.
      const cur = await getAgentBalance(key.userId);
      return NextResponse.json({
        ok: true,
        already_credited: true,
        balance_minor: cur.balance_minor.toString(),
        balance: minorToUsd(cur.balance_minor),
        currency: "USDC",
        ref,
      });
    }
    return NextResponse.json({
      ok: true,
      credited_minor: amountMinor.toString(),
      credited: amountUsd.toFixed(2),
      balance_minor: credit.balance_after.toString(),
      balance: minorToUsd(credit.balance_after),
      currency: "USDC",
      ref,
      mode: isTest ? "test" : "live",
    });
  }

  // ─── Stripe (human-in-the-loop) ──────────────────────────────────────
  if (provider === "stripe") {
    const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!stripeKey) {
      return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
    }
    const [row] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, key.userId))
      .limit(1);
    const email = (row?.email ?? "").trim();

    const form = new URLSearchParams();
    form.set("mode", "payment");
    if (email) form.set("customer_email", email);
    form.set("line_items[0][price_data][currency]", "usd");
    form.set("line_items[0][price_data][product_data][name]", `Dreyv agent balance top-up`);
    form.set(
      "line_items[0][price_data][product_data][description]",
      `$${amountUsd.toFixed(2)} USDC credit to agent ${key.userId.slice(0, 8)}`,
    );
    form.set("line_items[0][price_data][unit_amount]", String(Math.round(amountUsd * 100)));
    form.set("line_items[0][quantity]", "1");
    form.set("success_url", `${origin}/app/billing?topup=success&session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${origin}/app/billing?topup=cancel`);
    form.set("metadata[source]", "balance_topup");
    form.set("metadata[dreyv_user_id]", key.userId);
    form.set("metadata[amount_minor]", amountMinor.toString());

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
      note: "Open checkout_url to fund the prepaid balance. Credit applied on webhook receipt.",
    });
  }

  // ─── Paystack (human-in-the-loop, Africa-first) ──────────────────────
  if (provider === "paystack") {
    const { getPaystackSecret, paystackInitializeOneTime } = await import("@/lib/paystack");
    try { getPaystackSecret(); } catch {
      return NextResponse.json({ error: "paystack_not_configured" }, { status: 503 });
    }
    const [row] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, key.userId))
      .limit(1);
    const email = (row?.email ?? "").trim();
    if (!email) {
      return NextResponse.json(
        { error: "email_required", hint: "Add an email to the agent's profile — Paystack requires it." },
        { status: 422 },
      );
    }
    const session = await paystackInitializeOneTime({
      email,
      amountUsd,
      callbackUrl: `${origin}/app/billing?topup=success&provider=paystack`,
      metadata: { dreyv_user_id: key.userId, source: "balance_topup", amount_minor: amountMinor.toString() },
    });
    return NextResponse.json({
      ok: true,
      provider: "paystack",
      checkout_url: session.authorization_url,
      reference: session.reference,
      requires_human_step: true,
      note: "Open checkout_url to fund the prepaid balance. Credit applied on webhook receipt.",
    });
  }

  return NextResponse.json(
    { error: "unsupported_provider", supported: ["x402", "stripe", "paystack", "list"] },
    { status: 400 },
  );
}
