export const runtime = "edge";
import { NextResponse } from "next/server";
import { getPaymasterInfo } from "@/lib/paymaster/kora";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

/**
 * GET /api/paymaster/info
 *
 * Public Kora-compatible paymaster discovery. No auth required — agents
 * read this once to learn the paymaster pubkey + pricing, then build a
 * tx with that pubkey as fee payer and POST it to /api/paymaster/sponsor.
 */
export function GET() {
  const info = getPaymasterInfo();
  const origin = getSiteOrigin();
  return NextResponse.json(
    {
      service: "dreyv-kora-paymaster",
      spec: "https://github.com/solana-foundation/kora",
      version: "1",
      ...info,
      pricing: {
        unit: "USDC minor (6 decimals)",
        formula:
          "charged = ceil(fee_lamports * sol_usd_rate / 1e9 * 1e6) * (10_000 + markup_bps) / 10_000",
        billed_to: "agent prepaid balance (USDC)",
      },
      endpoints: {
        info: `${origin}/api/paymaster/info`,
        sponsor: `${origin}/api/paymaster/sponsor`,
      },
      auth: {
        type: "bearer",
        accepted_prefixes: ["dk_live_", "dk_test_"],
        required_scopes: ["pay:x402"],
        docs: `${origin}/auth.md`,
      },
      setup_note: info.available
        ? null
        : "Paymaster is not yet funded. Operator must set KORA_PAYMASTER_SECRET_BASE58 and fund the pubkey with SOL.",
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=60",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
