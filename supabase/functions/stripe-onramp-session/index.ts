// @ts-nocheck
// Stripe Crypto Onramp — mint a server-side session.
// -----------------------------------------------------------------------------
// Called from the Dreyv app (Next.js on Vercel) via supabase.functions.invoke
// to mint a Stripe Crypto Onramp Session using STRIPE_SECRET_KEY (kept here,
// never on Vercel). Returns { clientSecret, id } so the frontend can mount
// the embedded onramp via crypto-onramp-outer.js.
//
// Body: {
//   walletAddress?: string,            // when present, lock_wallet_address = true
//   walletAddresses?: Record<network, address>,
//   asset?: "usdc"|"sol"|..., network?: "solana"|"ethereum"|...,
//   sourceAmount?: string,             // USD numeric string, e.g. "250"
//   destinationAmount?: string,
//   sourceCurrency?: "usd"|"eur",
//   destinationCurrencies?: string[], destinationNetworks?: string[],
//   metadata?: Record<string,string>
// }
//
// Docs: https://docs.stripe.com/crypto/onramp/api-reference

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STRIPE_API = "https://api.stripe.com/v1/crypto/onramp_sessions";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secret) return json({ error: "STRIPE_SECRET_KEY not configured" }, 500);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
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
    customerIpAddress,
  } = body as Record<string, any>;

  const form = new URLSearchParams();

  // Lock wallet when we have one — eliminates the copy/paste step.
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
    source_amount: sourceAmount,
    destination_amount: destinationAmount,
    destination_currencies: destinationCurrencies,
    destination_networks: destinationNetworks,
  });

  if (metadata) appendForm(form, "metadata", metadata);
  if (customerIpAddress) form.append("customer_ip_address", String(customerIpAddress));

  const stripeRes = await fetch(STRIPE_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const data = await stripeRes.json().catch(() => ({}));

  if (!stripeRes.ok) {
    console.error("[stripe-onramp-session] Stripe error", stripeRes.status, data);
    return json(
      { error: data?.error?.message || "Stripe session mint failed", details: data },
      stripeRes.status,
    );
  }

  return json({
    id: data.id,
    clientSecret: data.client_secret,
    status: data.status,
    redirectUrl: data.redirect_url ?? null,
    livemode: data.livemode,
  });
});
