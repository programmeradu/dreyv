import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const amountStr = url.searchParams.get("amount") || "50";
  const amount = parseInt(amountStr, 10);

  if (isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
       return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL || url.origin;

    // Use native fetch to avoid adding the stripe npm package dependency
    const params = new URLSearchParams();
    params.append("payment_method_types[0]", "card");
    params.append("line_items[0][price_data][currency]", "eur");
    params.append("line_items[0][price_data][product_data][name]", "Founder's Rent Contribution");
    params.append("line_items[0][price_data][product_data][description]", "Help pay the rent so the founder doesn't starve.");
    params.append("line_items[0][price_data][unit_amount]", (amount * 100).toString());
    params.append("line_items[0][quantity]", "1");
    params.append("mode", "payment");
    params.append("success_url", `${origin}/auth?rent_paid=true`);
    params.append("cancel_url", `${origin}/auth?rent_canceled=true`);
    params.append("metadata[rent_contribution]", "true");

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await res.json();

    if (data.url) {
      return NextResponse.redirect(data.url);
    }

    console.error("Stripe Checkout Error:", data);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  } catch (error: any) {
    console.error("Stripe Checkout Error:", error);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
