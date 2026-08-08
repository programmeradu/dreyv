/**
 * GET /api/mcp/manifest — public, unauthenticated catalog of every MCP tool
 * exposed at /api/mcp. Used by /developers/mcp, agent directories, and the
 * .well-known/mcp.json discovery doc.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMcpManifest } from "@/lib/mcp/server";
import { getRequestOrigin } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const origin = getRequestOrigin(req);
  const manifest = getMcpManifest(origin);
  return NextResponse.json(manifest, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
