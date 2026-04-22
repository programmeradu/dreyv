import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";

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
            x402_version: "0.1",
            status: "advertised",
            description:
                "dreyv plans to gate select premium API routes with x402 (HTTP 402 Payment Required) so agents can pay-per-call without prior account setup.",
            facilitator: null,
            accepted_assets: [],
            networks: ["solana", "base"],
            protected_routes: [
                {
                    path: "/api/agent/*",
                    status: "planned",
                    description: "Per-call agent execution (analysis, transaction simulation).",
                },
                {
                    path: "/api/studio/*",
                    status: "planned",
                    description: "Studio AI architect & build endpoints.",
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
            },
        },
    );
}
