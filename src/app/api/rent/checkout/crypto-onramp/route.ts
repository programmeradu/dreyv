import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const amountStr = searchParams.get("amount") || "50";
  const amount = parseInt(amountStr, 10);

  if (isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  try {
    const params = new URLSearchParams();
    params.append("transaction_details[source_currency]", "eur");
    params.append("transaction_details[source_amount]", amount.toString());
    params.append("transaction_details[destination_currency]", "usdc");
    params.append("transaction_details[destination_network]", "solana");
    params.append("metadata[rent_contribution]", "true");

    const res = await fetch("https://api.stripe.com/v1/crypto/onramp_sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await res.json();

    if (data.redirect_url) {
      return NextResponse.redirect(data.redirect_url);
    }

    console.error("Stripe Onramp Error:", data);
    return NextResponse.json({ error: "Failed to create onramp session" }, { status: 500 });
  } catch (error) {
    console.error("Stripe Onramp Exception:", error);
    return NextResponse.json({ error: "Failed to create onramp session" }, { status: 500 });
  }
}
