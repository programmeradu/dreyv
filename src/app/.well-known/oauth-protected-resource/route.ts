import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-static";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * Tells agents which authorization servers can mint tokens for the dreyv
 * API and what scopes the resource accepts.
 */
export function GET() {
  const origin = getSiteOrigin();

  return NextResponse.json(
    {
      resource: `${origin}/api`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      scopes_supported: [
        "treasury:read",
        "treasury:write",
        "agent:execute",
        "mcp",
      ],
      resource_documentation: `${origin}/developers`,
      resource_signing_alg_values_supported: ["RS256", "ES256"],
      resource_name: "dreyv API",
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
