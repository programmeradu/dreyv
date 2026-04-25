/**
 * Dreyv Treasury Agent — Cloudflare Worker entry.
 *
 * One Worker, one Durable Object class (`TreasuryAgent`). Each DO instance
 * IS one Dreyv sub-agent with its own:
 *   - persistent storage (goal, conversation log, decisions, cooldowns, position memory)
 *   - alarm clock (the agent can wake itself up to re-check at any future time)
 *   - private message inbox (router → agent.send(...) lands here)
 *
 * Routing:
 *   POST /agent/:instanceName/message   → instance.send(message)
 *   GET  /agent/:instanceName/state     → instance.getState()
 *   POST /agent/:instanceName/reset     → instance.reset()
 *
 * The `:instanceName` is whatever the brain router passes — Dreyv conventions:
 *   - `subagent:${subagentId}` for per-sub-agent state
 *   - `user:${userId}`         for per-user shared memory
 *   - `vault:${vaultAddress}`  for per-vault state
 */

import { TreasuryAgent } from "./agent";

export interface Env {
  TREASURY_AGENT: DurableObjectNamespace;
  DREYV_BRAIN_BASE_URL: string;
  // AI?: any; // Workers AI binding (optional)
}

export { TreasuryAgent };

const AUTH_HEADER = "x-dreyv-agent-key";

function unauthorized() {
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

function notFound() {
  return new Response(JSON.stringify({ ok: false, error: "not_found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    // /agent/:instanceName/:op
    if (parts[0] !== "agent" || !parts[1] || !parts[2]) return notFound();

    // Shared-secret auth between brain → DO. The brain stores DREYV_AGENT_KEY
    // in env and includes it as `x-dreyv-agent-key`. (Set the same value via
    // `wrangler secret put DREYV_AGENT_KEY`.)
    const expected = (env as any).DREYV_AGENT_KEY as string | undefined;
    if (expected && request.headers.get(AUTH_HEADER) !== expected) {
      return unauthorized();
    }

    const instanceName = decodeURIComponent(parts[1]);
    const op = parts[2];

    const id = env.TREASURY_AGENT.idFromName(instanceName);
    const stub = env.TREASURY_AGENT.get(id);

    // Forward to the DO with a normalized internal path
    const internalUrl = new URL(request.url);
    internalUrl.pathname = `/__do/${op}`;
    return stub.fetch(internalUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
    });
  },
};
