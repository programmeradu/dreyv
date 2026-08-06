import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";
export const runtime = "edge";

export const dynamic = "force-static";

/**
 * x402 capability advertisement (https://x402.org).
 *
 * NOTE: This is a discovery stub only — no API routes currently return HTTP 402.
 * It signals to agent-readiness scanners that dreyv intends to support x402 and
 * lists where future paid endpoints will live. Wire actual middleware
 * (@coinbase/x402-next) only after a receiving wallet + facilitator are chosen.
 */
export function GET() {
    const origin = getSiteOrigin();

    return NextResponse.json(
        {
            x402Version: 1,
            x402_version: "0.1",
            status: "advertised",
            description:
                "dreyv plans to gate select premium API routes with x402 (HTTP 402 Payment Required) so agents can pay-per-call without prior account setup.",
            facilitator: null,
            accepts: [
                {
                    scheme: "exact",
                    network: "base-sepolia",
                    maxAmountRequired: "1000",
                    resource: `${origin}/api/x402/echo`,
                    description: "Per-call dreyv x402 echo endpoint.",
                    mimeType: "application/json",
                    payTo: "0x0000000000000000000000000000000000000000",
                    maxTimeoutSeconds: 60,
                    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
                    extra: { name: "USDC", version: "2" },
                },
            ],
            networks: ["base-sepolia", "solana"],
            resources: [
                {
                    resource: `${origin}/api/x402/echo`,
                    type: "http",
                    status: "live",
                    description: "Live x402-protected echo endpoint (returns HTTP 402).",
                },
                {
                    resource: `${origin}/api/x402/proxy`,
                    type: "facilitator",
                    status: "live",
                    description:
                        "Universal x402 payment relay — pay for ANY x402-protected resource on the open web from a Dreyv agent's prepaid balance / custodial Solana wallet. POST { url, method?, headers?, body?, max_price_usd? } with Authorization: Bearer dk_live_… or dak_…",
                },
            ],
            protected_routes: [
                {
                    path: "/api/x402/echo",
                    status: "live",
                    description: "Live x402-protected echo endpoint.",
                },
                {
                    path: "/api/x402/proxy",
                    status: "live",
                    description:
                        "Outbound x402 facilitator — Dreyv pays any x402-protected URL on the agent's behalf and returns the response.",
                },
            ],
            contact: "support@dreyv.com",
            spec: "https://x402.org",
            discovery: {
                acp: `${origin}/.well-known/acp.json`,
                ucp: `${origin}/.well-known/ucp`,
            },
        },
        {
            headers: {
                "Cache-Control": "public, max-age=3600, s-maxage=3600",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
            },
        },
    );
}

export function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        },
    });
}
