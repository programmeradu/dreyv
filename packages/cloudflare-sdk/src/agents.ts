/**
 * Cloudflare Agents (Durable Object) helpers.
 *
 * The Cloudflare Agents framework runs each agent instance as a stateful
 * Durable Object addressable by `{scriptName}/{instanceName}`. Dreyv treasury
 * sub-agents will be deployed as Worker scripts using this framework so each
 * vault gets its own long-lived agent loop with private state.
 *
 * This module provides:
 *   - `client(...)` — a typed RPC client to send messages to a deployed agent
 *     instance (works from Next.js server routes, edge functions, or the
 *     Inngest brain).
 *   - `defineAgent(...)` — a tiny helper used inside the Cloudflare Worker
 *     itself to declare an agent's message handlers + state shape.
 *
 * NOTE: `defineAgent` is intentionally a thin convention layer. The actual
 * Durable Object class is implemented in the Worker bundle; this helper just
 * standardises message envelopes and state typing across Dreyv agents.
 */

import { resolveConfig, authHeaders, cfFetch, accountUrl, type CFConfig } from "./_internal";

export interface AgentClientOptions {
  scriptName: string; // Worker script name (e.g. "dreyv-treasury-agent")
  instanceName: string; // Durable Object instance / room name (e.g. "vault-001")
  config?: Partial<CFConfig>;
}

export interface AgentMessage<T = unknown> {
  kind: string;
  payload?: T;
  /** Optional idempotency key — replays with the same key are de-duped by the agent. */
  idempotencyKey?: string;
}

export interface AgentResponse<T = unknown> {
  ok: boolean;
  state?: T;
  error?: string;
}

function agentUrl(cfg: CFConfig, scriptName: string, instanceName: string, path = "") {
  return accountUrl(
    cfg,
    `/workers/scripts/${scriptName}/agents/${encodeURIComponent(instanceName)}${path}`
  );
}

export function client<TState = unknown>(opts: AgentClientOptions) {
  const send = async <T = unknown>(message: AgentMessage<T>): Promise<AgentResponse<TState>> => {
    const cfg = resolveConfig(opts.config);
    const res = await cfFetch<any>(agentUrl(cfg, opts.scriptName, opts.instanceName, "/message"), {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify(message),
    });
    return {
      ok: !!res?.ok,
      state: res?.state as TState | undefined,
      error: res?.error,
    };
  };

  const getState = async (): Promise<TState | null> => {
    const cfg = resolveConfig(opts.config);
    try {
      const res = await cfFetch<any>(
        agentUrl(cfg, opts.scriptName, opts.instanceName, "/state"),
        { method: "GET", headers: authHeaders(cfg) }
      );
      return (res?.state as TState | undefined) ?? null;
    } catch (err: any) {
      if (err?.status === 404) return null;
      throw err;
    }
  };

  const reset = async (): Promise<{ ok: boolean }> => {
    const cfg = resolveConfig(opts.config);
    return cfFetch<{ ok: boolean }>(
      agentUrl(cfg, opts.scriptName, opts.instanceName, "/reset"),
      { method: "POST", headers: authHeaders(cfg) }
    );
  };

  return { send, getState, reset, scriptName: opts.scriptName, instanceName: opts.instanceName };
}

export type AgentHandler<TState, TPayload = unknown> = (ctx: {
  state: TState;
  message: AgentMessage<TPayload>;
  setState: (next: TState) => void;
}) => Promise<{ state?: TState; reply?: unknown } | void>;

export interface AgentDefinition<TState> {
  initialState: TState;
  handlers: Record<string, AgentHandler<TState>>;
}

/**
 * Convention helper for the Worker side. The actual DO class wires this up:
 *   const def = defineAgent({ initialState: { ... }, handlers: { tick: async (ctx) => ... } });
 *   export class TreasuryAgent { /* uses def *​/ }
 */
export function defineAgent<TState>(def: AgentDefinition<TState>): AgentDefinition<TState> {
  return def;
}

export const agents = { client, defineAgent };
