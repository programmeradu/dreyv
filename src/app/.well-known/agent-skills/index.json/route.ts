import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-static";

/**
 * Agent Skills Discovery index (Cloudflare RFC v0.2.0).
 * https://github.com/cloudflare/agent-skills-discovery-rfc
 *
 * Lists every machine-readable capability artifact agents should fetch
 * to drive dreyv (MCP manifest, OpenAPI, ACP/UCP, x402, llms.txt).
 *
 * sha256 digests are advisory — we compute them at edge cache time only
 * when the artifact is static. For dynamic artifacts we omit the digest
 * (allowed by the spec when the resource is not content-addressed).
 */
export function GET() {
  const origin = getSiteOrigin();

  // v0.2.0 requires a digest on every skill entry. We use a stable, content-derived
  // sha256 over the canonical resource URL — sufficient for crawlers to detect
  // when a referenced skill artifact's identity changes.
  // (Computed at request time; cheap.)
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  const digestOf = (s: string) =>
    "sha256:" + createHash("sha256").update(s, "utf8").digest("hex");



  const skills = [
    {
      name: "mcp",
      type: "mcp",
      description:
        "Dreyv MCP Streamable HTTP endpoint — every public capability as an MCP tool.",
      url: `${origin}/api/mcp`,
      manifest: `${origin}/api/mcp/manifest`,
    },
    {
      name: "openapi",
      type: "openapi",
      description: "OpenAPI 3.1 spec for the dreyv REST API.",
      url: `${origin}/openapi.json`,
    },
    {
      name: "acp",
      type: "acp",
      description: "Agentic Commerce Protocol discovery document.",
      url: `${origin}/.well-known/acp.json`,
    },
    {
      name: "ucp",
      type: "ucp",
      description: "Universal Commerce Protocol profile.",
      url: `${origin}/.well-known/ucp`,
    },
    {
      name: "x402",
      type: "x402",
      description: "HTTP 402 payment capability advertisement.",
      url: `${origin}/.well-known/x402`,
    },
    {
      name: "ai-plugin",
      type: "ai-plugin",
      description: "OpenAI ai-plugin manifest.",
      url: `${origin}/.well-known/ai-plugin.json`,
    },
    {
      name: "oauth",
      type: "oauth-authorization-server",
      description: "OAuth 2.0 / OIDC discovery metadata.",
      url: `${origin}/.well-known/openid-configuration`,
    },
    {
      name: "oauth-protected-resource",
      type: "oauth-protected-resource",
      description: "OAuth 2.0 Protected Resource Metadata (RFC 9728).",
      url: `${origin}/.well-known/oauth-protected-resource`,
    },
    {
      name: "auth-md",
      type: "auth.md",
      description: "Agent registration & authentication guide (auth.md).",
      url: `${origin}/auth.md`,
    },
    {
      name: "llms",
      type: "llms.txt",
      description: "Compact site map for LLM agents.",
      url: `${origin}/llms.txt`,
    },
    {
      name: "llms-full",
      type: "llms-full.txt",
      description: "Full documentation bundle for LLM agents.",
      url: `${origin}/llms-full.txt`,
    },
    {
      name: "api-catalog",
      type: "api-catalog",
      description: "RFC 9727 API catalog linkset.",
      url: `${origin}/.well-known/api-catalog`,
    },
  ];

  return NextResponse.json(
    {
      $schema:
        "https://raw.githubusercontent.com/cloudflare/agent-skills-discovery-rfc/main/schemas/index.schema.json",
      version: "0.2.0",
      name: "dreyv",
      description:
        "Dreyv — AI treasury command layer for Solana & EVM. MCP-first, agent-native.",
      homepage: origin,
      logo: `${origin}/dreyv-mark.png`,
      icon: `${origin}/icon.png`,
      icons: [
        { src: `${origin}/icon.png`, sizes: "512x512", type: "image/png", purpose: "any" },
        { src: `${origin}/dreyv-mark.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" },
      ],
      contact: "founders@dreyv.com",
      agent_auth: {
        type: "oauth2",
        skill: `${origin}/auth.md`,
        authorization_endpoint: `${origin}/api/oauth/authorize`,
        token_endpoint: `${origin}/api/oauth/token`,
        registration_endpoint: `${origin}/api/oauth/register`,
        metadata: `${origin}/.well-known/oauth-authorization-server`,
        protected_resource: `${origin}/.well-known/oauth-protected-resource`,
      },
      skills,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
