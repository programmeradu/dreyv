import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-static";

/**
 * RFC 9727 — api-catalog well-known URI.
 * Lists machine-readable descriptions of dreyv's public APIs.
 */
export function GET() {
    const origin = getSiteOrigin();

    return NextResponse.json(
        {
            linkset: [
                {
                    anchor: origin,
                    "service-doc": [
                        {
                            href: `${origin}/guides`,
                            type: "text/html",
                            title: "dreyv developer guides",
                        },
                    ],
                    "service-desc": [
                        {
                            href: `${origin}/openapi.json`,
                            type: "application/json",
                            title: "dreyv OpenAPI 3.1 spec",
                        },
                        {
                            href: `${origin}/.well-known/ai-plugin.json`,
                            type: "application/json",
                            title: "OpenAI ai-plugin manifest",
                        },
                        {
                            href: `${origin}/.well-known/acp.json`,
                            type: "application/json",
                            title: "ACP discovery document",
                        },
                        {
                            href: `${origin}/.well-known/ucp`,
                            type: "application/json",
                            title: "UCP profile",
                        },
                        {
                            href: `${origin}/.well-known/x402`,
                            type: "application/json",
                            title: "x402 capability",
                        },
                    ],
                    "status-page": [
                        {
                            href: `${origin}/`,
                            type: "text/html",
                        },
                    ],
                },
            ],
        },
        {
            headers: {
                "Content-Type": "application/linkset+json",
                "Cache-Control": "public, max-age=3600, s-maxage=3600",
            },
        },
    );
}
