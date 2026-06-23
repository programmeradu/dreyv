import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-static";

/**
 * OpenID Connect / OAuth 2.0 discovery metadata.
 *
 * Dreyv supports two authn flows for agents/humans:
 *   1. API keys (Bearer dk_live_…) — minted at /app/settings/api
 *   2. OAuth 2.1 device + authorization-code flow at /api/oauth/* (rolling out)
 *
 * Published so AI agents and MCP clients can auto-discover the issuer,
 * endpoints, and supported flows per RFC 8414 / OIDC Discovery 1.0.
 */
export function GET() {
  const origin = getSiteOrigin();

  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/api/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      device_authorization_endpoint: `${origin}/api/oauth/device`,
      registration_endpoint: `${origin}/api/oauth/register`,
      revocation_endpoint: `${origin}/api/oauth/revoke`,
      introspection_endpoint: `${origin}/api/oauth/introspect`,
      userinfo_endpoint: `${origin}/api/oauth/userinfo`,
      jwks_uri: `${origin}/.well-known/jwks.json`,
      response_types_supported: ["code", "token"],
      grant_types_supported: [
        "authorization_code",
        "refresh_token",
        "client_credentials",
        "urn:ietf:params:oauth:grant-type:device_code",
      ],
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "client_secret_post",
        "none",
      ],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: [
        "openid",
        "profile",
        "email",
        "treasury:read",
        "treasury:write",
        "agent:execute",
        "mcp",
      ],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256", "ES256"],
      service_documentation: `${origin}/developers`,
      agent_auth: {
        register_uri: `${origin}/app/settings/api`,
        supported_identity_types: ["agent", "user", "service"],
        supported_credential_types: ["api_key", "oauth_token", "siws_jwt"],
        claim_uri: `${origin}/auth.md`,
        revocation_uri: `${origin}/api/oauth/revoke`,
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
