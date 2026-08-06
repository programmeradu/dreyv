/**
 * GET /openapi.json — OpenAPI 3.1 spec for the public Dreyv API.
 *
 * Auto-generated from `CAPABILITIES` so every public capability has a
 * documented REST endpoint. A small set of legacy/non-capability routes
 * (health, planner, swap, vault) is appended by hand so they stay listed.
 *
 * Spec is also surfaced at:
 *   /.well-known/ai-plugin.json
 *   /.well-known/acp.json
 *   /.well-known/api-catalog
 *   /developers
 */

import { NextResponse } from "next/server";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getSiteOrigin } from "@/lib/seo/site";
import { CAPABILITIES, type PublicCapability } from "@/lib/capabilities/registry";

export const dynamic = "force-dynamic";
export const runtime = "edge";

// One JSON Schema per capability, cached at module init. The spec rebuilds
// at most once per cold start; we don't pay per request.
function buildInputSchema(cap: PublicCapability): Record<string, unknown> {
  try {
    const out = zodToJsonSchema(cap.inputSchema, {
      $refStrategy: "none",
      target: "openApi3",
    }) as Record<string, unknown>;
    delete out["$schema"];
    return out;
  } catch {
    return { type: "object", additionalProperties: true };
  }
}

function operationFor(cap: PublicCapability) {
  const inputSchema = buildInputSchema(cap);
  const tag = cap.pillar;
  const path = `/api/v1/${cap.id.replace(/\./g, "/")}`;

  // Read-only capabilities are reachable as GET with query params; everything
  // else uses POST with a JSON body. /api/v1/[...slug] supports both.
  const isGet = cap.sideEffects === "read";

  const op = {
    operationId: cap.mcpName,
    summary: cap.title,
    description: `${cap.description}\n\nMCP tool name: \`${cap.mcpName}\`\nScope required: \`${cap.scope}\``,
    tags: [tag],
    security: [{ bearerAuth: [] }],
    "x-dreyv-capability-id": cap.id,
    "x-dreyv-mcp-tool": cap.mcpName,
    "x-dreyv-scope": cap.scope,
    "x-dreyv-pillar": tag,
    "x-dreyv-cost-credits": cap.cost ?? 0,
    responses: {
      "200": {
        description: "Capability succeeded",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["ok", "capability", "latencyMs", "data"],
              properties: {
                ok: { type: "boolean", enum: [true] },
                capability: { type: "string", example: cap.id },
                latencyMs: { type: "integer" },
                data: {}, // capability-specific
              },
            },
          },
        },
      },
      "400": { $ref: "#/components/responses/InvalidInput" },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "403": { $ref: "#/components/responses/MissingScope" },
      "429": { $ref: "#/components/responses/RateLimited" },
      "500": { $ref: "#/components/responses/CapabilityFailed" },
    },
  } as Record<string, unknown>;

  if (isGet) {
    // Project the input schema's top-level properties into query parameters.
    const props = (inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (inputSchema.required ?? []) as string[];
    op.parameters = Object.entries(props).map(([name, schema]) => ({
      name,
      in: "query",
      required: required.includes(name),
      schema,
    }));
  } else {
    op.requestBody = {
      required: true,
      content: {
        "application/json": { schema: inputSchema },
      },
    };
  }

  return { method: isGet ? "get" : "post", path, op };
}

export function GET() {
  const origin = getSiteOrigin();

  const paths: Record<string, Record<string, unknown>> = {};
  const tags = new Set<string>();

  for (const cap of CAPABILITIES) {
    const { method, path, op } = operationFor(cap);
    if (!paths[path]) paths[path] = {};
    paths[path][method] = op;
    tags.add(cap.pillar);
  }

  // Hand-listed routes that aren't capability-backed but are still part of the
  // public surface. Keep here so they don't disappear from clients that only
  // read openapi.json.
  paths["/api/health"] = {
    get: {
      summary: "Liveness probe",
      tags: ["meta"],
      security: [],
      responses: { "200": { description: "OK" } },
    },
  };
  paths["/api/mcp"] = {
    post: {
      summary: "MCP Streamable HTTP transport — exposes every capability as an MCP tool",
      description:
        "JSON-RPC 2.0 transport per the MCP spec. Set `Accept: application/json, text/event-stream` and authenticate with the same `Authorization: Bearer dk_live_…` key used for REST.",
      tags: ["mcp"],
      security: [{ bearerAuth: [] }],
      "x-payment-info": {
        intent: "session",
        method: "stripe",
        amount: 0,
        currency: "USD",
        description:
          "Free tier covers basic MCP traffic; paid tiers metered via /pricing. x402 advertised at /.well-known/x402.",
      },
      responses: {
        "200": { description: "JSON-RPC response or SSE stream" },
        "401": { $ref: "#/components/responses/Unauthorized" },
        "402": {
          description: "Payment required (x402 / MPP) — see headers and body for requirements.",
        },
      },
    },
  };
  paths["/api/mcp/manifest"] = {
    get: {
      summary: "Public catalog of every MCP tool exposed at /api/mcp",
      tags: ["mcp"],
      security: [],
      responses: { "200": { description: "Manifest" } },
    },
  };
  tags.add("meta");
  tags.add("mcp");

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "dreyv API",
      version: "1.0.0",
      summary: "Non-custodial AI treasury OS for Solana + EVM.",
      description: `Public capability surface for the dreyv treasury workspace. Every endpoint here is also reachable as an MCP tool at \`/api/mcp\`.\n\nDreyv never custodies private keys; signing endpoints return unsigned transactions for the client to sign.\n\nAuthentication: \`Authorization: Bearer dk_live_…\` — mint a key at \`${origin}/app/settings/api\`.`,
      contact: { name: "dreyv", email: "founders@dreyv.com", url: `${origin}/developers` },
      license: { name: "Proprietary", url: `${origin}/legal/terms` },
      termsOfService: `${origin}/legal/terms`,
    },
    servers: [{ url: origin, description: "Production" }],
    security: [{ bearerAuth: [] }],
    tags: Array.from(tags).sort().map((name) => ({ name })),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "dk_live_…",
          description: "Dreyv public API key. Mint one at /app/settings/api.",
        },
      },
      schemas: {
        Problem: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
            capability: { type: "string" },
          },
        },
      },
      responses: {
        InvalidInput: {
          description: "Input failed schema validation",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  error: { type: "string", enum: ["invalid_input"] },
                  details: { type: "object" },
                },
              },
            },
          },
        },
        Unauthorized: {
          description: "Missing or invalid Bearer key",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } },
        },
        MissingScope: {
          description: "Key does not carry the required scope",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } },
        },
        RateLimited: {
          description: "Per-key rate limit exceeded",
          headers: {
            "Retry-After": { schema: { type: "integer" }, description: "Seconds until retry" },
          },
          content: { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } },
        },
        CapabilityFailed: {
          description: "Capability handler threw",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } },
        },
      },
    },
    paths,
    "x-dreyv": {
      capabilityCount: CAPABILITIES.length,
      mcpEndpoint: `${origin}/api/mcp`,
      mcpManifest: `${origin}/api/mcp/manifest`,
      discovery: `${origin}/.well-known/mcp.json`,
    },
    "x-payment-info": {
      providers: ["stripe", "paystack", "x402"],
      discovery: {
        x402: `${origin}/.well-known/x402`,
        acp: `${origin}/.well-known/acp.json`,
        ucp: `${origin}/.well-known/ucp`,
      },
      pricing: `${origin}/pricing`,
    },
  } as const;

  return NextResponse.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
