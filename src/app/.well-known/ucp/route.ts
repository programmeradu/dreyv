import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-static";

/**
 * Universal Commerce Protocol (UCP) profile.
 * https://ucp.dev/specification/overview/
 */
export function GET() {
    const origin = getSiteOrigin();

    return NextResponse.json(
        {
            ucp_version: "0.1",
            name: "dreyv",
            description:
                "AI treasury command layer for Solana & Web3 teams. Plain-language intent, simulation before signing, multisig-native.",
            services: [
                {
                    id: "marketplace",
                    type: "catalog",
                    endpoint: `${origin}/api/studio/marketplace`,
                    schema: `${origin}/.well-known/acp.json`,
                },
                {
                    id: "subscriptions",
                    type: "subscription",
                    endpoint: `${origin}/pricing`,
                },
            ],
            capabilities: {
                payments: ["fastspring", "paddle", "x402:advertised"],
                onchain: ["solana"],
                discovery: ["acp", "ucp", "x402"],
            },
            endpoints: {
                api_catalog: `${origin}/.well-known/api-catalog`,
                acp: `${origin}/.well-known/acp.json`,
                x402: `${origin}/.well-known/x402`,
                docs: `${origin}/guides`,
            },
            contact: "support@dreyv.com",
        },
        {
            headers: {
                "Cache-Control": "public, max-age=3600, s-maxage=3600",
            },
        },
    );
}
