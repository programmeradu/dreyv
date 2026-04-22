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
            api_base_url: `${origin}/api`,
            transports: ["https"],
            capabilities: {
                services: [
                    {
                        name: "marketplace",
                        description:
                            "dreyv mini-app marketplace — discover and purchase agent skills, treasury widgets, and yield strategies.",
                        endpoint: `${origin}/api/studio/marketplace`,
                        methods: ["GET"],
                    },
                    {
                        name: "subscriptions",
                        description:
                            "dreyv tier subscriptions (Free / Mini / Max) via FastSpring (primary) or Paddle (reference).",
                        endpoint: `${origin}/pricing`,
                        methods: ["GET"],
                    },
                ],
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
