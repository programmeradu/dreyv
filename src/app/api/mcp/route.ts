/**
 * Dreyv MCP server — Streamable HTTP transport.
 *
 *   Endpoint: POST/GET/DELETE https://dreyv.com/api/mcp
 *   Auth:     Authorization: Bearer dk_live_…  (or dk_test_…)
 *
 * Built on `mcp-lite` + Hono. Tools are generated 1:1 from the public
 * capability registry, so REST and MCP never drift.
 *
 * MCP transport requires Accept: application/json, text/event-stream — that's
 * handled by the StreamableHttpTransport itself.
 */

import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import {
  listPublicCapabilities,
  getCapabilityByMcpName,
} from "@/lib/capabilities/registry";
import {
  extractBearer,
  resolvePublicKey,
  hasScope,
  checkRateLimit,
  recordUsage,
  type ResolvedPublicKey,
} from "@/lib/api-keys/public-keys";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const server = new McpServer({
  name: "dreyv-mcp",
  version: "1.0.0",
  schemaAdapter: (schema) => z.toJSONSchema(schema as z.ZodTypeAny),
});

// Register every capability as an MCP tool. The handler closure validates
// the bearer (passed by the route as a Hono context var) before running.
for (const cap of listPublicCapabilities()) {
  server.tool(cap.mcpName, {
    description: `${cap.title} — ${cap.description}`,
    inputSchema: cap.inputSchema,
    handler: async (input: unknown, extra: unknown) => {
      const key = (extra as { context?: { key?: ResolvedPublicKey } } | undefined)?.context?.key;
      if (!key) {
        return {
          isError: true,
          content: [{ type: "text", text: "unauthorized: missing dk_live_/dk_test_ bearer" }],
        };
      }
      if (!hasScope(key, cap.scope)) {
        return {
          isError: true,
          content: [{ type: "text", text: `missing_scope: ${cap.scope}` }],
        };
      }
      const rl = checkRateLimit(key);
      if (!rl.ok) {
        await recordUsage({
          keyId: key.id, userId: key.userId, capabilityId: cap.id,
          transport: "mcp", status: "rate_limited", latencyMs: 0, errorCode: "rate_limited",
        });
        return {
          isError: true,
          content: [{ type: "text", text: `rate_limited: retry in ${Math.ceil(rl.retryAfterMs / 1000)}s` }],
        };
      }
      const t0 = Date.now();
      try {
        const origin = (extra as { context?: { origin?: string } } | undefined)?.context?.origin ?? "";
        const data = await cap.handler(input as never, {
          userId: key.userId,
          keyId: key.id,
          origin,
          transport: "mcp",
        });
        await recordUsage({
          keyId: key.id, userId: key.userId, capabilityId: cap.id,
          transport: "mcp", status: "ok", latencyMs: Date.now() - t0, costCredits: cap.cost ?? 0,
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        await recordUsage({
          keyId: key.id, userId: key.userId, capabilityId: cap.id,
          transport: "mcp", status: "error", latencyMs: Date.now() - t0,
          errorCode: err instanceof Error ? err.message.slice(0, 120) : "error",
        });
        return {
          isError: true,
          content: [{ type: "text", text: err instanceof Error ? err.message : "Capability failed" }],
        };
      }
    },
  });
}

const transport = new StreamableHttpTransport();
const httpHandler = transport.bind(server);

// Hono app exposing the MCP endpoint with bearer auth + context injection.
const app = new Hono().basePath("/api/mcp");

app.all("/", async (c) => {
  const bearer = extractBearer(c.req.raw);
  const key = await resolvePublicKey(bearer);
  if (!key) {
    return c.json(
      {
        jsonrpc: "2.0",
        error: { code: -32001, message: "unauthorized: provide Authorization: Bearer dk_live_…" },
        id: null,
      },
      401,
    );
  }
  const origin = new URL(c.req.url).origin;
  // Pass the resolved key + origin into the per-tool handler via mcp-lite's
  // request context.
  return await httpHandler(c.req.raw, { context: { key, origin } });
});

export const GET = (req: Request) => app.fetch(req);
export const POST = (req: Request) => app.fetch(req);
export const DELETE = (req: Request) => app.fetch(req);
