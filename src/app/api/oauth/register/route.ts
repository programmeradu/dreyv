/**
 * POST /api/oauth/register — Dynamic Client Registration (RFC 7591).
 *
 * Public endpoint; MCP clients (Claude, ChatGPT, Cursor, Cline) discover it
 * via /.well-known/openid-configuration and self-register on first connect.
 */

import { NextRequest, NextResponse } from "next/server";
import { registerClient } from "@/lib/oauth/clients";

export const dynamic = "force-dynamic";
export const runtime = "edge";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "0.0.0.0";
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "Body must be JSON" },
      { status: 400, headers: CORS },
    );
  }

  const result = await registerClient(
    {
      redirect_uris: Array.isArray(body.redirect_uris) ? (body.redirect_uris as string[]) : [],
      client_name: typeof body.client_name === "string" ? body.client_name : undefined,
      client_uri: typeof body.client_uri === "string" ? body.client_uri : undefined,
      logo_uri: typeof body.logo_uri === "string" ? body.logo_uri : undefined,
      grant_types: Array.isArray(body.grant_types) ? (body.grant_types as string[]) : undefined,
      response_types: Array.isArray(body.response_types) ? (body.response_types as string[]) : undefined,
      token_endpoint_auth_method:
        typeof body.token_endpoint_auth_method === "string"
          ? (body.token_endpoint_auth_method as "none" | "client_secret_basic" | "client_secret_post")
          : undefined,
      scope: typeof body.scope === "string" ? body.scope : undefined,
      software_id: typeof body.software_id === "string" ? body.software_id : undefined,
      software_version: typeof body.software_version === "string" ? body.software_version : undefined,
    },
    { ip: clientIp(req) },
  );

  if (!result.ok) {
    const status = result.error === "rate_limited" ? 429 : 400;
    return NextResponse.json(
      { error: result.error, error_description: result.description },
      { status, headers: CORS },
    );
  }

  return NextResponse.json(result.client, { status: 201, headers: CORS });
}
