import { NextRequest, NextResponse } from "next/server";
import { paystackInitializeOneTime } from "@/lib/paystack";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const amountStr = url.searchParams.get("amount") || "50";
  const amount = parseInt(amountStr, 10);

  if (isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || url.origin;
    
    // Using the one-time paystack helper which converts USD (or EUR in our fun case) to GHS
    const { authorization_url } = await paystackInitializeOneTime({
        email: "founder-rent@dreyv.com",
        amountUsd: amount, // Treating EUR as roughly equivalent to USD for this helper
        callbackUrl: `${origin}/auth?rent_paid=true`,
        metadata: {
            rent_contribution: "true",
            amount_eur: amount
        }
    });

    return NextResponse.redirect(authorization_url);
  } catch (error: any) {
    console.error("Paystack Checkout Error:", error);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
