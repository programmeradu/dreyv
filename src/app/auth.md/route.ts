import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-static";

/**
 * /auth.md — agent registration & authentication guide.
 * Spec: https://github.com/workos/auth.md
 */
export function GET() {
  const origin = getSiteOrigin();

  const body = `# Auth.md

_Dreyv — Agent Authentication_

> Machine-readable auth guide for AI agents and MCP clients.
> Spec: https://workos.com/auth.md, https://github.com/workos/auth.md

## Identity types

- **agent** — autonomous AI agent acting on behalf of a user or org
- **user** — human end-user
- **service** — backend service / worker

## Credential types

1. **API key** (\`Authorization: Bearer dk_live_…\`) — long-lived, scoped.
   - Mint at: ${origin}/app/settings/api
   - Rotate or revoke at the same URL.
2. **OAuth 2.1 token** — short-lived bearer, refresh + PKCE.
   - Discovery: ${origin}/.well-known/openid-configuration
   - Protected resource: ${origin}/.well-known/oauth-protected-resource
3. **SIWS JWT** (Sign-In With Solana) — wallet-based humans only.

## Registration

| Step | URL | Notes |
| --- | --- | --- |
| Register an OAuth client (RFC 7591 DCR) | ${origin}/api/oauth/register | Returns \`client_id\` / \`client_secret\` |
| **Machine signup (autonomous)**         | ${origin}/api/agents/signup  | One call → user + client + default \`dk_live_\` key. No human in the loop. |
| Mint API key (human-issued)             | ${origin}/app/settings/api   | Cookie-auth UI |
| **Mint API key (programmatic)**         | ${origin}/api/keys           | Bearer-auth; requires \`agent:delegate\` scope |
| Subscribe a tier (ACP checkout)         | ${origin}/api/acp/checkout   | x402 (fully agentic) · stripe · paystack |
| Request scopes                          | \`treasury:read\`, \`treasury:write\`, \`agent:execute\`, \`mcp\` |  |
| Revoke credential                       | ${origin}/api/oauth/revoke   |  |


## Discovery surface

- MCP:      ${origin}/api/mcp  (manifest: ${origin}/api/mcp/manifest)
- OpenAPI:  ${origin}/openapi.json
- ACP:      ${origin}/.well-known/acp.json
- UCP:      ${origin}/.well-known/ucp
- x402:     ${origin}/.well-known/x402
- Skills:   ${origin}/.well-known/agent-skills/index.json

## Contact

founders@dreyv.com
`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
