/**
 * @dreyv/mcp — official helper for the Dreyv remote MCP server.
 *
 * The Dreyv MCP server is a Streamable HTTP endpoint at
 *   https://dreyv.com/api/mcp
 * authenticated with a Bearer key minted at https://dreyv.com/app/settings/api
 * (keys are prefixed `dk_live_`).
 *
 * This package intentionally ships no transport of its own. It exposes:
 *   - constants (endpoint URL, discovery URL, key prefix)
 *   - a small factory that returns the exact `transport` config the AI SDK
 *     MCP client expects, so callers don't have to remember the shape
 *   - a fetch-based discovery helper so agents can self-describe
 *
 * The actual MCP client is created by the caller with `@ai-sdk/mcp`'s
 * `createMCPClient`. Keeping the client out of this package means we don't
 * pin an AI SDK version and don't force a transport dependency on users
 * who only want the constants.
 */

export const DREYV_MCP_ENDPOINT = "https://dreyv.com/api/mcp" as const;
export const DREYV_MCP_DISCOVERY = "https://dreyv.com/.well-known/mcp.json" as const;
export const DREYV_MCP_MANIFEST = "https://dreyv.com/api/mcp/manifest" as const;
export const DREYV_API_KEY_PREFIX = "dk_live_" as const;
export const DREYV_KEY_MINT_URL = "https://dreyv.com/app/settings/api" as const;

export interface DreyvMcpOptions {
  /** Bearer API key (dk_live_...). Required. */
  apiKey: string;
  /** Override endpoint (defaults to production). Useful for staging. */
  endpoint?: string;
  /** Extra headers to merge onto every request. */
  headers?: Record<string, string>;
}

export interface DreyvMcpTransportConfig {
  type: "http";
  url: string;
  headers: Record<string, string>;
}

function assertKey(apiKey: string): void {
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("[@dreyv/mcp] apiKey is required");
  }
  if (!apiKey.startsWith(DREYV_API_KEY_PREFIX)) {
    // Non-fatal — dev/agent keys use other prefixes — but warn once.
    // eslint-disable-next-line no-console
    console.warn(
      `[@dreyv/mcp] apiKey does not start with "${DREYV_API_KEY_PREFIX}". ` +
        `Mint a live key at ${DREYV_KEY_MINT_URL} if this is unexpected.`,
    );
  }
}

/**
 * Build the `transport` config for the AI SDK's `createMCPClient`.
 *
 * ```ts
 * import { createMCPClient } from "@ai-sdk/mcp";
 * import { dreyvMcpTransport } from "@dreyv/mcp";
 *
 * const client = await createMCPClient({
 *   transport: dreyvMcpTransport({ apiKey: process.env.DREYV_API_KEY! }),
 * });
 * const tools = await client.tools();
 * ```
 */
export function dreyvMcpTransport(opts: DreyvMcpOptions): DreyvMcpTransportConfig {
  assertKey(opts.apiKey);
  return {
    type: "http",
    url: opts.endpoint ?? DREYV_MCP_ENDPOINT,
    headers: {
      authorization: `Bearer ${opts.apiKey}`,
      "user-agent": "dreyv-mcp-client/0.1.0",
      ...(opts.headers ?? {}),
    },
  };
}

export interface DreyvMcpDiscovery {
  name: string;
  version: string;
  description: string;
  endpoint: string;
  manifest: string;
  transport: string;
  tools: number;
  authentication: {
    type: string;
    keyMintUrl: string;
    keyPrefix: string;
  };
}

/** Fetch the public `/.well-known/mcp.json` discovery doc. No auth required. */
export async function fetchDreyvMcpDiscovery(
  fetchImpl: typeof fetch = fetch,
): Promise<DreyvMcpDiscovery> {
  const res = await fetchImpl(DREYV_MCP_DISCOVERY, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`[@dreyv/mcp] discovery fetch failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as DreyvMcpDiscovery;
}
