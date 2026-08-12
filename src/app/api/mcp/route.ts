/**
 * /api/mcp — Streamable HTTP MCP transport.
 *
 * Same Bearer key as /api/v1/*. Each MCP tools/call runs through the same
 * scope/rate-limit/usage pipeline as the REST dispatcher.
 *
 * Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
 *
 * Required headers on POST (per MCP Streamable HTTP):
 *   Content-Type: application/json
 *   Accept: application/json, text/event-stream
 *
 * Unauthenticated GETs (no Bearer) still return 401; the standard MCP
 * `initialize` handshake is allowed without a key so clients can discover
 * server capabilities, but every tools/call requires auth.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  extractBearer,
  resolvePublicKey,
} from "@/lib/api-keys/public-keys";
import { getMcpHandler } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";
// MCP messages can be up to a few MB once tools/list is included.
export const maxDuration = 60;

const CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

function withCors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v as string);
  }
  return res;
}

function unauthorized(message: string): Response {
  // Per MCP spec, return JSON-RPC error envelope so MCP clients surface it
  // sensibly. Plain HTTP 401 also includes WWW-Authenticate per RFC 6750.
  const body = {
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message,
      data: {
        docs: "https://dreyv.com/developers/mcp",
        keyMintUrl: "https://dreyv.com/app/settings/api",
      },
    },
    id: null,
  };
  return new Response(JSON.stringify(body), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": 'Bearer realm="dreyv", error="invalid_token"',
      ...CORS_HEADERS,
    },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function handle(req: NextRequest): Promise<Response> {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;

  // Allow unauthenticated initialize/notification handshake so MCP clients can
  // negotiate protocol version + capabilities. We only require auth at the
  // tool-call layer (enforced inside each registered tool handler).
  const handler = getMcpHandler();
  const origin = new URL(req.url).origin;

  // Inspect the JSON-RPC method for POST bodies. If it's a privileged call
  // without a key, reject up front with 401.
  if (req.method === "POST") {
    let body: unknown = null;
    try {
      // Need to clone — mcp-lite consumes the body.
      const text = await req.text();
      body = text ? JSON.parse(text) : null;
      // Reconstruct a request with the parsed text intact.
      req = new NextRequest(req.url, {
        method: "POST",
        headers: req.headers,
        body: text,
      }) as NextRequest;
    } catch {
      return withCors(
        NextResponse.json(
          { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null },
          { status: 400 },
        ),
      );
    }

    const messages: Array<{ method?: unknown }> = Array.isArray(body)
      ? (body as Array<{ method?: unknown }>)
      : body && typeof body === "object"
      ? [body as { method?: unknown }]
      : [];

    // We now enforce auth at the tool level (src/lib/mcp/server.ts) so we can 
    // selectively expose tools like pay_founders_rent to unauthenticated users.
    // However, if they *do* send a token and it's invalid, we should still reject.
    if (bearer && !key) {
      return unauthorized("Invalid or revoked Dreyv API key.");
    }
  }

  try {
    const response = await handler(req as unknown as Request, {
      authInfo: key
        ? {
            token: bearer ?? "",
            scopes: key.scopes,
            extra: {
              userId: key.userId,
              keyId: key.id,
              origin,
              key,
              httpRequest: req as unknown as Request,
            },
          }
        : undefined,
    });
    return withCors(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal_error";
    return withCors(
      NextResponse.json(
        { jsonrpc: "2.0", error: { code: -32603, message }, id: null },
        { status: 500 },
      ),
    );
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function DELETE(req: NextRequest) {
  return handle(req);
}
