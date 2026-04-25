/**
 * Dreyv ↔ Cloudflare Agent client.
 *
 * Thin wrapper used by the Vercel-side brain to talk to the deployed
 * `dreyv-treasury-agent` Worker. Each Dreyv sub-agent lives as a Durable
 * Object instance addressed by `subagent:${id}` (or `user:${userId}`,
 * `vault:${address}`). State persists per-instance, forever, until reset.
 *
 * Required env (set in Vercel):
 *   - DREYV_AGENT_WORKER_URL   e.g. "https://dreyv-treasury-agent.you.workers.dev"
 *   - DREYV_AGENT_KEY          shared secret matching the Worker's `wrangler secret put`
 *
 * If either env is missing we degrade to no-op + structured log so dev still
 * works without the Worker deployed.
 */

const HEADER = "x-dreyv-agent-key";

function workerUrl(): string | null {
  return process.env.DREYV_AGENT_WORKER_URL?.replace(/\/$/, "") ?? null;
}
function workerKey(): string | null {
  return process.env.DREYV_AGENT_KEY ?? null;
}
function ready(): boolean {
  return Boolean(workerUrl() && workerKey());
}

export type AgentInstanceName = `subagent:${string}` | `user:${string}` | `vault:${string}` | string;

export interface AgentMessage<T = unknown> {
  kind: "init" | "tick" | "observe" | "instruct" | "shutdown" | string;
  payload?: T;
  idempotencyKey?: string;
}

export interface AgentSendResult {
  ok: boolean;
  reply?: unknown;
  meta?: unknown;
  reason?: string;
}

async function call(
  instanceName: AgentInstanceName,
  op: "message" | "state" | "reset",
  init: RequestInit,
): Promise<{ ok: boolean; data?: any; reason?: string }> {
  if (!ready()) {
    console.log("[agent-client:skip]", instanceName, op, "(worker not configured)");
    return { ok: false, reason: "worker_not_configured" };
  }
  const url = `${workerUrl()}/agent/${encodeURIComponent(instanceName)}/${op}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        [HEADER]: workerKey()!,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[agent-client:error]", res.status, body.slice(0, 200));
      return { ok: false, reason: `worker_${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, data };
  } catch (e: any) {
    const reason = e?.name === "AbortError" ? "worker_timeout_8s" : e?.message || "unknown";
    console.warn("[agent-client:exception]", instanceName, op, reason);
    return { ok: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendAgent(
  instanceName: AgentInstanceName,
  message: AgentMessage,
): Promise<AgentSendResult> {
  const r = await call(instanceName, "message", { method: "POST", body: JSON.stringify(message) });
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, reply: r.data?.reply, meta: r.data?.meta };
}

export async function getAgentState(instanceName: AgentInstanceName): Promise<unknown | null> {
  const r = await call(instanceName, "state", { method: "GET" });
  if (!r.ok) return null;
  return r.data?.state ?? null;
}

export async function resetAgent(instanceName: AgentInstanceName): Promise<boolean> {
  const r = await call(instanceName, "reset", { method: "POST" });
  return r.ok;
}

/** Convenience: send to a sub-agent by id. */
export function subagentInstance(subagentId: string): AgentInstanceName {
  return `subagent:${subagentId}` as AgentInstanceName;
}

/** Convenience: send to a user-scoped agent. */
export function userInstance(userId: string): AgentInstanceName {
  return `user:${userId}` as AgentInstanceName;
}

/** Convenience: send to a vault-scoped agent. */
export function vaultInstance(vaultAddress: string): AgentInstanceName {
  return `vault:${vaultAddress}` as AgentInstanceName;
}

export const isAgentWorkerConfigured = ready;
