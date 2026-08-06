import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";
export const runtime = "edge";

export const dynamic = "force-static";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) + auth.md agent_auth block.
 *
 * Tells agents which authorization servers can mint tokens for the dreyv
 * API and how to register as an agent identity (per workos auth.md spec).
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
      // auth.md compatibility — duplicated here so scanners that only probe
      // the protected-resource document still discover the agent_auth block.
      auth_md: `${origin}/auth.md`,
      agent_auth: {
        type: "oauth2",
        skill: `${origin}/auth.md`,
        auth_md: `${origin}/auth.md`,
        register_uri: `${origin}/api/oauth/register`,
        authorization_endpoint: `${origin}/api/oauth/authorize`,
        token_endpoint: `${origin}/api/oauth/token`,
        registration_endpoint: `${origin}/api/oauth/register`,
        revocation_endpoint: `${origin}/api/oauth/revoke`,
        claim_uri: `${origin}/auth.md`,
        revocation_uri: `${origin}/api/oauth/revoke`,
        supported_identity_types: ["agent", "user", "service"],
        identity_types_supported: ["agent", "user", "service"],
        supported_credential_types: ["api_key", "oauth_token", "siws_jwt"],
        credential_types_supported: ["api_key", "oauth_token", "siws_jwt"],
        events_supported: ["revocation"],
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
