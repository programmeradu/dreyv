import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/stripe/onramp/session
 * ───────────────────────────────
 * Mints a Stripe Crypto Onramp Session server-side using STRIPE_SECRET_KEY and
 * returns { id, clientSecret } so the browser can mount the embedded onramp.
 *
 * Ported from the former Supabase edge function — the app is now
 * single-runtime (Next.js on Cloudflare) with no external function host.
 *
 * Docs: https://docs.stripe.com/crypto/onramp/api-reference
 */

export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1/crypto/onramp_sessions";

function appendForm(form: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => form.append(`${key}[${i}]`, String(v)));
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      appendForm(form, `${key}[${k}]`, v);
    }
  } else {
    form.append(key, String(value));
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json({ error: "STRIPE_SECRET_KEY not configured" }, { status: 500 });
  }

  let body: Record<string, any>;
  try {
    body = (await req.json()) as Record<string, any>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    walletAddress,
    walletAddresses,
    asset,
    network,
    sourceAmount,
    destinationAmount,
    sourceCurrency = "usd",
    destinationCurrencies,
    destinationNetworks,
    metadata,
  } = body;

  const form = new URLSearchParams();

  // Lock the wallet when we have one — removes the copy/paste step for users.
  if (walletAddress && network) {
    appendForm(form, "wallet_addresses", { [network]: walletAddress });
    form.append("lock_wallet_address", "true");
  } else if (walletAddresses && Object.keys(walletAddresses).length) {
    appendForm(form, "wallet_addresses", walletAddresses);
    form.append("lock_wallet_address", "true");
  }

  appendForm(form, "transaction_details", {
    source_currency: sourceCurrency,
    destination_currency: asset,
    destination_network: network,
    source_exchange_amount: sourceAmount,
    destination_exchange_amount: destinationAmount,
    destination_currencies: destinationCurrencies,
    destination_networks: destinationNetworks,
  });

  if (metadata) appendForm(form, "metadata", metadata);

  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip) form.append("customer_ip_address", ip);

  const stripeRes = await fetch(STRIPE_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const data: any = await stripeRes.json().catch(() => ({}));

  if (!stripeRes.ok) {
    console.error("[stripe/onramp/session] Stripe error", stripeRes.status, data?.error?.message);
    return NextResponse.json(
      { error: data?.error?.message || "Stripe session mint failed" },
      { status: stripeRes.status },
    );
  }

  return NextResponse.json({
    id: data.id,
    clientSecret: data.client_secret,
    status: data.status,
    redirectUrl: data.redirect_url ?? null,
    livemode: data.livemode,
  });
}
