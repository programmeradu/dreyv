"use client";

import { useEffect } from "react";

/**
 * WebMCP loader — exposes a small set of dreyv site tools to in-browser
 * AI agents via `navigator.modelContext.provideContext()`.
 *
 * Spec: https://webmachinelearning.github.io/webmcp/
 *
 * Tools listed here are intentionally read-only and navigational so they
 * are safe to expose without auth. Mutating tools live behind the
 * authenticated MCP endpoint at /api/mcp.
 */
export function WebMCPProvider() {
  useEffect(() => {
    type ModelContext = {
      provideContext?: (ctx: {
        tools?: Array<{
          name: string;
          description: string;
          inputSchema: Record<string, unknown>;
          execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
        }>;
      }) => void;
    };
    const nav = navigator as Navigator & { modelContext?: ModelContext };
    if (!nav.modelContext?.provideContext) return;

    try {
      nav.modelContext.provideContext({
        tools: [
          {
            name: "dreyv_open_developers",
            description: "Open the dreyv developer hub.",
            inputSchema: { type: "object", properties: {} },
            execute: () => {
              window.location.href = "/developers";
              return { ok: true };
            },
          },
          {
            name: "dreyv_open_mcp_docs",
            description: "Open the dreyv MCP documentation.",
            inputSchema: { type: "object", properties: {} },
            execute: () => {
              window.location.href = "/developers/mcp";
              return { ok: true };
            },
          },
          {
            name: "dreyv_discovery",
            description:
              "Return URLs to dreyv's machine-readable discovery surface (MCP, OpenAPI, ACP, UCP, x402, OAuth).",
            inputSchema: { type: "object", properties: {} },
            execute: () => {
              const origin = window.location.origin;
              return {
                mcp: `${origin}/api/mcp`,
                mcpManifest: `${origin}/api/mcp/manifest`,
                openapi: `${origin}/openapi.json`,
                acp: `${origin}/.well-known/acp.json`,
                ucp: `${origin}/.well-known/ucp`,
                x402: `${origin}/.well-known/x402`,
                oauth: `${origin}/.well-known/openid-configuration`,
                protectedResource: `${origin}/.well-known/oauth-protected-resource`,
                skills: `${origin}/.well-known/agent-skills/index.json`,
                authMd: `${origin}/auth.md`,
                llms: `${origin}/llms.txt`,
              };
            },
          },
          {
            name: "dreyv_open_pricing",
            description: "Open the dreyv pricing page.",
            inputSchema: { type: "object", properties: {} },
            execute: () => {
              window.location.href = "/pricing";
              return { ok: true };
            },
          },
        ],
      });
    } catch (err) {
      // Best-effort — never crash the page if a browser ships a slightly
      // different WebMCP shape during the API's evolution.
      console.warn("[WebMCP] provideContext failed:", err);
    }
  }, []);

  return null;
}
