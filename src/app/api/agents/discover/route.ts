/**
 * GET /api/agents/discover — AEP-style capability discovery (#7).
 *
 * Public read. Lets any agent or marketplace ask "what can Dreyv do that
 * matches X?" and get back a deterministic answer with price + scope + SLA
 * hints, suitable for a `discover → negotiate → pay` loop.
 *
 * Query:
 *   q          free-text match against id / title / description / pillar
 *   pillar     exact-match filter
 *   scope      exact-match filter
 *   side_effect "read" | "write"
 *   limit      1..200 (default 50)
 *
 * Response:
 *   {
 *     query, total, results: [
 *       { id, mcp_name, pillar, scope, side_effects, status, title,
 *         description, price_usd, currency, settle_paths, rest_url,
 *         mcp_tool, docs_url }
 *     ]
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { CAPABILITIES } from "@/lib/capabilities/registry";

export const dynamic = "force-dynamic";

// Default per-call billing — kept in sync with src/app/api/v1/[...slug]/route.ts.
// When we add per-capability pricing, expose it here.
const DEFAULT_PRICE_USD = 0.001;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
} as const;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = url.origin;
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const pillar = url.searchParams.get("pillar")?.trim().toLowerCase() || null;
  const scope = url.searchParams.get("scope")?.trim().toLowerCase() || null;
  const sideEffect = url.searchParams.get("side_effect")?.trim().toLowerCase() || null;
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50)));

  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];

  const filtered = CAPABILITIES.filter((c) => {
    if (pillar && c.pillar.toLowerCase() !== pillar) return false;
    if (scope && c.scope.toLowerCase() !== scope) return false;
    if (sideEffect && c.sideEffects.toLowerCase() !== sideEffect) return false;
    if (tokens.length === 0) return true;
    const hay = `${c.id} ${c.mcpName ?? ""} ${c.title} ${c.description} ${c.pillar}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  }).slice(0, limit);

  const results = filtered.map((c) => ({
    id: c.id,
    mcp_name: c.mcpName ?? null,
    pillar: c.pillar,
    scope: c.scope,
    side_effects: c.sideEffects,
    status: c.status,
    title: c.title,
    description: c.description,
    price_usd: DEFAULT_PRICE_USD,
    currency: "usd",
    settle_paths: [
      { rail: "prepaid_balance", endpoint: "/api/agents/balance" },
      { rail: "x402_usdc_solana", endpoint: "/api/x402/checkout" },
    ],
    rest_url: `${origin}/api/v1/${c.id.replace(/\./g, "/")}`,
    mcp_tool: c.mcpName ?? null,
    docs_url: `${origin}/developers/capabilities#${c.id}`,
  }));

  return NextResponse.json(
    {
      query: { q: q || null, pillar, scope, side_effect: sideEffect, limit },
      total: results.length,
      mcp_endpoint: `${origin}/api/mcp`,
      rest_base: `${origin}/api/v1`,
      negotiation_hint:
        "All capabilities ship with a fixed per-call price. To 'negotiate', pick a settle_path: prepaid_balance is the cheapest single-step rail; x402_usdc_solana is fully stateless and replayable.",
      results,
    },
    { headers: CORS_HEADERS },
  );
}
