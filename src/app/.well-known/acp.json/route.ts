import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-static";

/**
 * Agentic Commerce Protocol (ACP) discovery document.
 * https://agenticcommerce.dev
 *
 * Lets AI agents discover dreyv's commerce surface (marketplace mini-apps,
 * subscription tiers) without first creating a checkout session.
 */
export function GET() {
    const origin = getSiteOrigin();

    return NextResponse.json(
        {
            protocol: {
                name: "acp",
                version: "0.1",
            },
            name: "dreyv",
            description:
                "dreyv commerce surface — marketplace mini-apps and subscription tiers, agent-discoverable.",
            logo: `${origin}/dreyv-mark.png`,
            icon: `${origin}/icon.png`,
            icons: [
                { src: `${origin}/icon.png`, sizes: "512x512", type: "image/png", purpose: "any" },
                { src: `${origin}/dreyv-mark.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" },
            ],
            api_base_url: `${origin}/api`,
            transports: ["https"],
            capabilities: {
                payments: {
                    x402: {
                        status: "advertised",
                        discovery: "/.well-known/x402",
                    },
                },
                services: {
                    marketplace: {
                        name: "marketplace",
                        description:
                            "dreyv mini-app marketplace — discover and purchase agent skills, treasury widgets, and yield strategies.",
                        endpoint: `${origin}/api/studio/marketplace`,
                        methods: ["GET"],
                        protocol: "https",
                    },
                    subscriptions: {
                        name: "subscriptions",
                        description:
                            "dreyv tier subscriptions (Free / Mini / Max) via Stripe + Paystack.",
                        endpoint: `${origin}/pricing`,
                        methods: ["GET"],
                        protocol: "https",
                    },
                    checkout: {
                        name: "checkout",
                        description:
                            "Agentic checkout session creation for marketplace + subscriptions.",
                        endpoint: `${origin}/api/checkout`,
                        methods: ["POST"],
                        protocol: "https",
                    },
                },
            },
            agent_auth: {
                type: "oauth2",
                skill: `${origin}/auth.md`,
                authorization_endpoint: `${origin}/api/oauth/authorize`,
                token_endpoint: `${origin}/api/oauth/token`,
                registration_endpoint: `${origin}/api/oauth/register`,
                metadata: `${origin}/.well-known/oauth-authorization-server`,
            },
            contact: "support@dreyv.com",
            documentation: `${origin}/guides`,
        },
        {
            headers: {
                "Cache-Control": "public, max-age=3600, s-maxage=3600",
            },
        },
    );
}
