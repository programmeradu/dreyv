/**
 * /.well-known/mcp.json — discovery doc per the emerging MCP server
 * discovery convention. Points crawlers/agents at the Streamable HTTP
 * endpoint and the public manifest.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMcpToolCount } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  return NextResponse.json(
    {
      name: "dreyv",
      version: "1.0.0",
      description:
        "Non-custodial AI treasury OS for Solana + EVM. Read positions, simulate, execute, govern — all unsigned-tx, all behind one Bearer key.",
      logo: `${origin}/dreyv-mark.png`,
      icon: `${origin}/icon.png`,
      icons: [
        { src: `${origin}/icon.png`, sizes: "512x512", type: "image/png", purpose: "any" },
        { src: `${origin}/dreyv-mark.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" },
      ],
      transport: "streamable-http",
      endpoint: `${origin}/api/mcp`,
      manifest: `${origin}/api/mcp/manifest`,
      docs: `${origin}/developers/mcp`,
      tools: getMcpToolCount(),
      authentication: {
        type: "bearer",
        keyMintUrl: `${origin}/app/settings/api`,
        keyPrefix: "dk_live_",
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
