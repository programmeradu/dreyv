/**
 * GET /api/billing/crypto/pricing
 *
 * Single source of truth for the discounted crypto USD price per tier.
 * Reads `usdPriceFor` from `src/lib/billing/crypto-pricing.ts` so the UI
 * never drifts from the server-side discount logic.
 */
import { NextResponse } from "next/server";
import { usdPriceFor } from "@/lib/billing/crypto-pricing";
export const runtime = "edge";

export async function GET() {
    return NextResponse.json({
        ok: true,
        discountPct: 10,
        tiers: {
            mini: { usd: usdPriceFor("mini") },
            max:  { usd: usdPriceFor("max")  },
        },
    }, { headers: { "cache-control": "public, max-age=60" } });
}
