/**
 * Dreyv MCP server — auto-built from the public capability registry.
 *
 * Every entry in `CAPABILITIES` becomes one MCP tool. The same auth → scope →
 * policy → rate-limit → recordUsage pipeline used by /api/v1/[...slug] runs
 * inside each tool handler, so the REST surface and the MCP surface are
 * always in lockstep.
 *
 * Auth flows in via `bind({ authInfo })` on the transport: the route handler
 * resolves the Bearer key first, then sets `authInfo.extra.{userId,keyId}`
 * which tool handlers read off `ctx.authInfo`.
 */

import { McpServer, StreamableHttpTransport, RpcError } from "mcp-lite";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  CAPABILITIES,
  type PublicCapability,
} from "@/lib/capabilities/registry";
import {
  hasScope,
  checkRateLimit,
  recordUsage,
  type ResolvedPublicKey,
} from "@/lib/api-keys/public-keys";
import { checkPolicy } from "@/lib/api-keys/policy";
import { CapabilityError } from "@/lib/capabilities/handlers";

const SERVER_INFO = {
  name: "dreyv",
  version: "1.1.0",
} as const;

/**
 * MCP `initialize` `instructions` field — shown to LLMs/agents on connect so
 * they understand what Dreyv is and the critical execution model (non-custodial,
 * caller signs). Keep short; deeper docs live in `meta.intents_howto`.
 */
const MCP_INSTRUCTIONS = [
  "Dreyv exposes 300+ tools spanning portfolio analytics, on-chain forensics, DeFi routing, agent commerce, governance, and observability.",
  "",
  "CRITICAL — execution model is NON-CUSTODIAL:",
  "  • Tools tagged [READ] return data and never touch chain.",
  "  • Tools tagged [UNSIGNED-TX] (e.g. dreyv_defi_swap_tx, dreyv_defi_stake_sol_tx, dreyv_intents_compile)",
  "    return a base64/base58 transaction or ExecutorPlan for YOUR wallet (or the user's wallet) to sign locally.",
  "    Dreyv NEVER signs Solana/EVM transactions server-side.",
  "  • Tools tagged [WRITE] mutate Dreyv-owned state (webhooks, alerts, contracts, deliverables).",
  "  • Tools tagged [PAY] (dreyv_economy_pay) settle USDC autonomously from the agent's HOSTED wallet — fund it first via dreyv_economy_wallet_address.",
  "",
  "Discovery: call `dreyv_meta_capabilities_overview` for the 39-pillar map; `dreyv_meta_intents_howto` for the compile→sign→submit flow; `dreyv_meta_version` for schema/changelog.",
  "Auth: pass `Authorization: Bearer dk_live_…` on every tools/call. Mint keys at https://dreyv.com/app/settings/api.",
].join("\n");

/** JSON-RPC error codes per the MCP spec / JSON-RPC 2.0. */
const JSON_RPC = {
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // App-defined range starts at -32000.
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32002,
  RATE_LIMITED: -32004,
} as const;

interface AuthExtra {
  userId: string;
  keyId: string;
  origin: string;
  /** The full resolved key, kept for scope/policy/rate-limit checks. */
  key: ResolvedPublicKey;
  /** The original HTTP Request, needed by checkPolicy for IP/Origin/Referer. */
  httpRequest: Request;
}

function extraFrom(authInfo: unknown): AuthExtra | null {
  if (!authInfo || typeof authInfo !== "object") return null;
  const e = (authInfo as { extra?: unknown }).extra;
  if (!e || typeof e !== "object") return null;
  const x = e as Record<string, unknown>;
  if (
    typeof x.userId === "string" &&
    typeof x.keyId === "string" &&
    typeof x.origin === "string" &&
    x.key &&
    typeof x.key === "object" &&
    x.httpRequest instanceof Request
  ) {
    return x as unknown as AuthExtra;
  }
  return null;
}

/**
 * zod-to-json-schema adapter. Wrapped so a malformed schema for a single
 * capability never crashes the whole tools/list call — fall back to a permissive
 * object schema and tag the description.
 */
function schemaAdapter(schema: unknown): Record<string, unknown> {
  try {
    const out = zodToJsonSchema(schema as Parameters<typeof zodToJsonSchema>[0], {
      $refStrategy: "none",
      target: "jsonSchema7",
    }) as Record<string, unknown>;
    // Strip the top-level $schema key — MCP clients don't need it.
    delete out["$schema"];
    return out;
  } catch {
    return { type: "object", additionalProperties: true };
  }
}

/**
 * Strong, agent-readable label of what calling this tool will actually do.
 * Surfaced both in the description text (so LLMs see it inline) and in
 * `_meta.executionLabel` (so deterministic clients can branch on it).
 *
 * Categories:
 *   READ          — pure read; safe to call freely.
 *   UNSIGNED-TX   — returns a transaction or ExecutorPlan for the CALLER to sign locally; non-custodial.
 *   WRITE         — mutates Dreyv-owned state (webhooks, alerts, contracts, schemas, deliverables, etc.).
 *   PAY           — autonomously settles USDC from the agent's hosted wallet (real money out).
 */
function executionLabelFor(cap: PublicCapability): "READ" | "UNSIGNED-TX" | "WRITE" | "PAY" {
  if (cap.id === "economy.pay") return "PAY";
  if (cap.sideEffects === "read") return "READ";
  if (cap.sideEffects === "simulate") return "UNSIGNED-TX";
  // Compiled intents return an unsigned plan even though we persist a row.
  if (cap.id === "intents.compile") return "UNSIGNED-TX";
  return "WRITE";
}

/** Compact summary line shown to LLMs in addition to the description. */
function describe(cap: PublicCapability): string {
  const label = executionLabelFor(cap);
  const cost = cap.cost ? `, cost: ${cap.cost} credits` : "";
  return `[${label}] ${cap.description} (pillar: ${cap.pillar}, scope: ${cap.scope}${cost})`;
}

function buildServer(): McpServer {
  const server = new McpServer({
    ...SERVER_INFO,
    instructions: MCP_INSTRUCTIONS,
    schemaAdapter,
  });

  for (const cap of CAPABILITIES) {
    const label = executionLabelFor(cap);
    server.tool(cap.mcpName, {
      title: cap.title,
      description: describe(cap),
      inputSchema: cap.inputSchema as unknown as Parameters<typeof server.tool>[1]["inputSchema"],
      annotations: {
        readOnlyHint: cap.sideEffects === "read",
        destructiveHint: label === "WRITE" || label === "PAY",
        idempotentHint: cap.sideEffects === "read" || cap.sideEffects === "simulate",
        openWorldHint: cap.sideEffects === "write",
      },
      _meta: {
        capabilityId: cap.id,
        pillar: cap.pillar,
        scope: cap.scope,
        status: cap.status,
        executionLabel: label,
        restPath: `/api/v1/${cap.id.replace(/\./g, "/")}`,
      },
      handler: async (args, ctx) => {
        const t0 = Date.now();
        const extra = extraFrom(ctx.authInfo);
        if (!extra) {
          throw new RpcError(
            JSON_RPC.UNAUTHORIZED,
            "Missing Dreyv API key. Send `Authorization: Bearer dk_live_…` on the MCP request.",
          );
        }

        // 1. Scope
        if (!hasScope(extra.key, cap.scope)) {
          await recordUsage({
            keyId: extra.keyId,
            userId: extra.userId,
            capabilityId: cap.id,
            transport: "mcp",
            status: "denied",
            latencyMs: Date.now() - t0,
            errorCode: "missing_scope",
          });
          throw new RpcError(
            JSON_RPC.FORBIDDEN,
            `Missing scope: ${cap.scope}. Granted: ${extra.key.scopes.join(", ") || "(none)"}.`,
          );
        }

        // 2. Policy (kill switch, capability allowlist, origin, IP)
        const policy = checkPolicy(extra.key, cap.id, extra.httpRequest);
        if (!policy.ok) {
          await recordUsage({
            keyId: extra.keyId,
            userId: extra.userId,
            capabilityId: cap.id,
            transport: "mcp",
            status: "denied",
            latencyMs: Date.now() - t0,
            errorCode: policy.code,
          });
          throw new RpcError(JSON_RPC.FORBIDDEN, policy.message, policy.detail);
        }

        // 3. Rate limit (per-key, sliding window already in checkRateLimit)
        const rl = checkRateLimit(extra.key);
        if (!rl.ok) {
          await recordUsage({
            keyId: extra.keyId,
            userId: extra.userId,
            capabilityId: cap.id,
            transport: "mcp",
            status: "rate_limited",
            latencyMs: Date.now() - t0,
            errorCode: "rate_limited",
          });
          throw new RpcError(
            JSON_RPC.RATE_LIMITED,
            `Rate limit exceeded. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s. Limit: ${extra.key.rateLimitRpm} rpm.`,
            { retryAfterMs: rl.retryAfterMs, limitRpm: extra.key.rateLimitRpm },
          );
        }

        // 3. Re-validate input with the canonical zod schema. mcp-lite may
        // accept lax JSON; we want the same validation as REST.
        const parsed = cap.inputSchema.safeParse(args ?? {});
        if (!parsed.success) {
          await recordUsage({
            keyId: extra.keyId,
            userId: extra.userId,
            capabilityId: cap.id,
            transport: "mcp",
            status: "error",
            latencyMs: Date.now() - t0,
            errorCode: "invalid_input",
          });
          throw new RpcError(
            JSON_RPC.INVALID_PARAMS,
            "invalid_input",
            parsed.error.flatten(),
          );
        }

        // 4. Execute
        try {
          const result = await cap.handler(parsed.data, {
            userId: extra.userId,
            keyId: extra.keyId,
            origin: extra.origin,
            transport: "mcp",
          });
          const latencyMs = Date.now() - t0;
          await recordUsage({
            keyId: extra.keyId,
            userId: extra.userId,
            capabilityId: cap.id,
            transport: "mcp",
            status: "ok",
            latencyMs,
            costCredits: cap.cost ?? 0,
          });

          // Return both a textual summary (for non-structured clients) and the
          // structured payload (preferred by modern MCP clients).
          const summary = summarize(result);
          return {
            content: [{ type: "text", text: summary }],
            structuredContent: { ok: true, capability: cap.id, latencyMs, data: result },
          };
        } catch (err) {
          const latencyMs = Date.now() - t0;
          const status = err instanceof CapabilityError ? err.status : 500;
          const message = err instanceof Error ? err.message : "internal_error";
          await recordUsage({
            keyId: extra.keyId,
            userId: extra.userId,
            capabilityId: cap.id,
            transport: "mcp",
            status: "error",
            latencyMs,
            errorCode: String(status),
          });
          throw new RpcError(
            status >= 400 && status < 500 ? JSON_RPC.INVALID_PARAMS : JSON_RPC.INTERNAL_ERROR,
            message,
            { capability: cap.id, status },
          );
        }
      },
    });
  }

  return server;
}

/**
 * Cap result preview shown in the `content[].text` payload. We deliberately
 * keep this small — agents typically read `structuredContent` — but a string
 * is required by the MCP spec, so we give them something useful for logs.
 */
function summarize(result: unknown): string {
  if (result == null) return "ok";
  if (typeof result === "string") return result;
  try {
    const s = JSON.stringify(result);
    return s.length > 2000 ? `${s.slice(0, 2000)}… (${s.length} chars; see structuredContent)` : s;
  } catch {
    return "ok";
  }
}

// One server + transport instance per process. Tools are stateless;
// per-request state lives entirely in `authInfo`.
let _server: McpServer | null = null;
let _transport: StreamableHttpTransport | null = null;
let _bound: ((request: Request, options?: { authInfo?: { token: string; scopes: string[]; extra?: Record<string, unknown> } }) => Promise<Response>) | null = null;

export function getMcpHandler() {
  if (!_bound) {
    _server = buildServer();
    _transport = new StreamableHttpTransport();
    _bound = _transport.bind(_server);
  }
  return _bound;
}

/** Tool count — used by the manifest and docs page. */
export function getMcpToolCount(): number {
  return CAPABILITIES.length;
}

/** Public manifest payload — registry projection, no auth required. */
export function getMcpManifest(origin: string) {
  return {
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    transport: "streamable-http",
    endpoint: `${origin}/api/mcp`,
    authentication: {
      type: "bearer",
      scheme: "Bearer",
      docs: `${origin}/developers/mcp`,
      keyMintUrl: `${origin}/app/settings/api`,
      keyPrefix: "dk_live_",
    },
    capabilityCount: CAPABILITIES.length,
    pillars: Array.from(new Set(CAPABILITIES.map((c) => c.pillar))).sort(),
    scopes: Array.from(new Set(CAPABILITIES.map((c) => c.scope))).sort(),
    tools: CAPABILITIES.map((c) => ({
      name: c.mcpName,
      capabilityId: c.id,
      title: c.title,
      description: c.description,
      pillar: c.pillar,
      scope: c.scope,
      sideEffects: c.sideEffects,
      status: c.status,
      restPath: `/api/v1/${c.id.replace(/\./g, "/")}`,
      cost: c.cost ?? 0,
    })),
  };
}
