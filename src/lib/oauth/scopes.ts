/**
 * OAuth scope catalog. Mapped onto the existing public-API scope vocabulary
 * so OAuth-issued JWTs and dk_live_… API keys share one authorization model
 * inside capability handlers.
 */

import type { ApiScope } from "@/lib/api-keys/public-keys";
import { ALL_SCOPES } from "@/lib/api-keys/public-keys";

export type OAuthScope =
  | "openid"
  | "profile"
  | "email"
  | "offline_access"
  | "mcp"
  | "treasury:read"
  | "treasury:write"
  | "agent:execute"
  | "agent:full_access";

export const OAUTH_SCOPES: OAuthScope[] = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "mcp",
  "treasury:read",
  "treasury:write",
  "agent:execute",
  "agent:full_access",
];

export const SCOPE_LABELS: Record<OAuthScope, { title: string; description: string }> = {
  openid: { title: "Sign in", description: "Confirm who you are on dreyv." },
  profile: { title: "Basic profile", description: "Read your display name and avatar." },
  email: { title: "Email", description: "Read the email on your dreyv account." },
  offline_access: {
    title: "Stay connected",
    description: "Keep the connection alive in the background via refresh tokens.",
  },
  mcp: {
    title: "Use dreyv as an MCP tool",
    description: "Call dreyv's Model Context Protocol endpoint on your behalf.",
  },
  "treasury:read": {
    title: "Read treasury data",
    description: "View balances, portfolio, transactions, and analytics.",
  },
  "treasury:write": {
    title: "Propose treasury actions",
    description:
      "Build and simulate transactions you must still sign yourself — dreyv never custodies your keys.",
  },
  "agent:execute": {
    title: "Full Agentic Access",
    description: "Complete autonomous access to all 300+ capabilities (gated by your subscription tier).",
  },
  "agent:full_access": {
    title: "Full Agentic Access",
    description: "Complete autonomous access to all 300+ capabilities (gated by your subscription tier).",
  },
};

/**
 * Translate OAuth scopes → existing internal `ApiScope` values consumed by
 * capability handlers. A single OAuth scope expands into the full
 * fine-grained set the handler layer expects.
 */
export function expandToApiScopes(oauth: OAuthScope[]): ApiScope[] {
  const out = new Set<ApiScope>();
  for (const s of oauth) {
    switch (s) {
      case "treasury:read":
        [
          "read:portfolio",
          "read:treasury",
          "read:market",
          "read:forensics",
          "read:notifications",
          "read:audit",
          "read:insights",
          "read:reports",
          "read:status",
          "read:marketplace",
          "read:search",
        ].forEach((x) => out.add(x as ApiScope));
        break;
      case "treasury:write":
        [
          "write:simulate",
          "write:intent",
          "write:trade",
          "write:watchers",
          "write:notifications",
          "write:reports",
          "write:tags",
        ].forEach((x) => out.add(x as ApiScope));
        break;
      case "agent:execute":
        ALL_SCOPES.forEach((x) => out.add(x as ApiScope));
        break;
      case "agent:full_access":
        ALL_SCOPES.forEach((x) => out.add(x as ApiScope));
        break;
      case "mcp":
        // mcp on its own only carries the right to call /api/mcp — actual
        // tool calls still require treasury:read/write/etc.
        break;
      default:
        break;
    }
  }
  return Array.from(out);
}

export function parseScopeString(raw: string | null | undefined): OAuthScope[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s): s is OAuthScope => (OAUTH_SCOPES as string[]).includes(s));
}

export function scopesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
