import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";
export const runtime = "edge";

export const dynamic = "force-static";

/**
 * Agentic Commerce Protocol (ACP) discovery document.
 * Spec: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/blob/main/rfcs/rfc.discovery.md
 *
 * Schema (strict):
 *   protocol.name = "acp"
 *   protocol.version = "YYYY-MM-DD" (latest)
 *   protocol.supported_versions = string[] chronological
 *   api_base_url = string
 *   transports = string[] including "rest"
 *   capabilities.services = string[] from {checkout, orders, delegate_payment, carts}
 */
export function GET() {
  const origin = getSiteOrigin();

  return NextResponse.json(
    {
      protocol: {
        name: "acp",
        version: "2026-01-30",
        supported_versions: ["2025-09-29", "2025-12-12", "2026-01-16", "2026-01-30"],
        documentation_url: "https://agenticcommerce.dev",
      },
      api_base_url: `${origin}/api`,
      transports: ["rest"],
      capabilities: {
        services: ["checkout"],
        extensions: [
          {
            name: "x402",
            spec: "https://x402.org",
          },
          {
            name: "agent_auth",
            spec: `${origin}/auth.md`,
          },
        ],
        supported_currencies: ["usd"],
        supported_locales: ["en-US"],
      },
      // Non-spec metadata (additive, ignored by strict validators).
      agent_auth: {
        type: "oauth2",
        auth_md: `${origin}/auth.md`,
        skill: `${origin}/auth.md`,
        authorization_endpoint: `${origin}/api/oauth/authorize`,
        token_endpoint: `${origin}/api/oauth/token`,
        registration_endpoint: `${origin}/api/oauth/register`,
        metadata: `${origin}/.well-known/oauth-authorization-server`,
      },
      contact: "support@dreyv.com",
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
