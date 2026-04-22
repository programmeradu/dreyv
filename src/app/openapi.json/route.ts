import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-static";

/**
 * OpenAPI 3.1 spec for the public + agent-relevant subset of the dreyv API.
 * Canonical at /openapi.json. Linked from /.well-known/ai-plugin.json,
 * /.well-known/acp.json, /.well-known/api-catalog, and /developers.
 */
export function GET() {
  const origin = getSiteOrigin();

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "dreyv API",
      version: "1.0.0",
      summary: "Non-custodial AI treasury command layer for Solana.",
      description:
        "Public + agent-relevant endpoints for the dreyv treasury workspace. dreyv never custodies private keys; signing endpoints return unsigned transactions for the client to sign.",
      contact: { name: "dreyv", email: "founders@dreyv.com", url: `${origin}/developers` },
      license: { name: "Proprietary", url: `${origin}/legal/terms` },
      termsOfService: `${origin}/legal/terms`,
    },
    servers: [{ url: origin, description: "Production" }],
    security: [{ bearerAuth: [] }, { apiKey: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
        oauth2: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: `${origin}/api/auth/authorize`,
              tokenUrl: `${origin}/api/auth/token`,
              scopes: { read: "Read account data", write: "Create plans and proposals" },
            },
          },
        },
      },
      schemas: {
        Problem: {
          type: "object",
          properties: {
            type: { type: "string" },
            title: { type: "string" },
            status: { type: "integer" },
            detail: { type: "string" },
          },
        },
        Price: {
          type: "object",
          properties: {
            token: { type: "string", example: "SOL" },
            usd: { type: "number", example: 168.42 },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        Plan: {
          type: "object",
          properties: {
            id: { type: "string" },
            steps: { type: "array", items: { type: "object" } },
            simulation: { type: "object" },
          },
        },
      },
    },
    paths: {
      "/api/health": {
        get: {
          summary: "Liveness probe",
          security: [],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/price": {
        get: {
          summary: "Get token price",
          security: [],
          parameters: [
            { name: "token", in: "query", required: true, schema: { type: "string" }, example: "SOL" },
          ],
          responses: {
            "200": {
              description: "Price payload",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Price" } } },
            },
          },
        },
      },
      "/api/atlas/tokens": {
        get: {
          summary: "List tracked tokens",
          security: [],
          responses: { "200": { description: "Token directory" } },
        },
      },
      "/api/atlas/tokens/{symbol}": {
        get: {
          summary: "Token details",
          security: [],
          parameters: [
            { name: "symbol", in: "path", required: true, schema: { type: "string" }, example: "SOL" },
          ],
          responses: { "200": { description: "Token detail payload" } },
        },
      },
      "/api/planner": {
        post: {
          summary: "Compile a treasury intent into a plan",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["intent"],
                  properties: { intent: { type: "string", example: "rebalance 25% USDC into mSOL over 5 days" } },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Plan",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Plan" } } },
            },
            "401": { description: "Unauthenticated" },
          },
        },
      },
      "/api/simulate": {
        post: {
          summary: "Simulate a plan against forked state",
          responses: { "200": { description: "Simulation result" } },
        },
      },
      "/api/swap/quote": {
        post: {
          summary: "Get a Jupiter swap quote",
          responses: { "200": { description: "Quote" } },
        },
      },
      "/api/swap/execute": {
        post: {
          summary: "Build a sign-ready swap transaction (non-custodial)",
          responses: { "200": { description: "Unsigned transaction" } },
        },
      },
      "/api/vault/balances": {
        get: {
          summary: "Get multisig vault balances",
          responses: { "200": { description: "Balances" } },
        },
      },
      "/api/squads/propose": {
        post: {
          summary: "Create a Squads multisig proposal",
          responses: { "200": { description: "Proposal id" } },
        },
      },
      "/api/research": {
        post: {
          summary: "Run agent research (Cloudflare /crawl backed)",
          responses: { "200": { description: "Research result" } },
        },
      },
    },
  } as const;

  return NextResponse.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
