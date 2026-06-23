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
    type Tool = {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      execute?: (input: Record<string, unknown>) => Promise<unknown> | unknown;
    };
    type ModelContext = {
      registerTool?: (tool: Tool) => unknown;
      provideContext?: (ctx: { tools?: Tool[] }) => void;
    };
    const nav = navigator as Navigator & { modelContext?: ModelContext };
    if (!nav.modelContext) return;

    const origin = window.location.origin;
    const tools: Tool[] = [
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
        execute: () => ({
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
        }),
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
    ];

    try {
      if (typeof nav.modelContext!.registerTool === "function") {
        for (const tool of tools) nav.modelContext!.registerTool(tool);
      }
      if (typeof nav.modelContext!.provideContext === "function") {
        nav.modelContext!.provideContext({ tools });
      }
    } catch (err) {
      console.warn("[WebMCP] tool registration failed:", err);
    }
  }, []);

  return null;
}
