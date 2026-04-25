/**
 * TreasuryAgent — the Durable Object class.
 *
 * One instance per Dreyv sub-agent. Lifecycle:
 *
 *   1. First message creates the agent: `{ kind: "init", payload: { goal, userId, walletAddress, ttlMinutes } }`
 *   2. The brain (or the agent itself via alarm) sends `{ kind: "tick" }` to
 *      run a reasoning pass. The agent reads its memory, decides what to do,
 *      may emit an opportunity back to the brain, and schedules its next alarm.
 *   3. The brain forwards material chain events as `{ kind: "observe", payload: {...} }`
 *      so the agent can react in <100ms instead of waiting for the next tick.
 *   4. The user can send `{ kind: "instruct", payload: { text } }` to give the
 *      agent new context. Stored in conversation log.
 *   5. After `ttlExpiresAt`, the next tick deletes the agent's storage and
 *      stops scheduling alarms.
 *
 * Memory shape (keys in `state.storage`):
 *   - "meta"         → { goal, userId, walletAddress, createdAt, ttlExpiresAt }
 *   - "log"          → AgentLogEntry[] (capped at 100 most recent)
 *   - "decisions"    → AgentDecision[] (capped at 50)
 *   - "cooldowns"    → Record<string, number> (op → unlock-at ms)
 *   - "positions"    → Record<string, number> (mint → balance, agent's own view)
 *   - "stats"        → { ticks, opportunitiesEmitted, alertsSent, lastTickAt }
 */

import type { Env } from "./worker";

export interface AgentMeta {
  goal: string;
  userId: string | null;
  walletAddress: string | null;
  createdAt: number;
  ttlExpiresAt: number;
  tickIntervalMs: number;
}

export interface AgentLogEntry {
  at: number;
  kind: string;
  summary: string;
  payload?: unknown;
}

export interface AgentDecision {
  at: number;
  op: string;
  rationale: string;
  forwarded: boolean;
}

export interface AgentStats {
  ticks: number;
  opportunitiesEmitted: number;
  alertsSent: number;
  lastTickAt: number | null;
}

export interface AgentMessage<T = unknown> {
  kind: "init" | "tick" | "observe" | "instruct" | "shutdown" | string;
  payload?: T;
  idempotencyKey?: string;
}

const MAX_LOG = 100;
const MAX_DECISIONS = 50;
const DEFAULT_TICK_MS = 30 * 60_000; // 30 min

export class TreasuryAgent {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  /* ───────── Storage helpers ───────── */
  private async getMeta(): Promise<AgentMeta | null> {
    return (await this.state.storage.get<AgentMeta>("meta")) ?? null;
  }
  private async getLog(): Promise<AgentLogEntry[]> {
    return (await this.state.storage.get<AgentLogEntry[]>("log")) ?? [];
  }
  private async getDecisions(): Promise<AgentDecision[]> {
    return (await this.state.storage.get<AgentDecision[]>("decisions")) ?? [];
  }
  private async getCooldowns(): Promise<Record<string, number>> {
    return (await this.state.storage.get<Record<string, number>>("cooldowns")) ?? {};
  }
  private async getPositions(): Promise<Record<string, number>> {
    return (await this.state.storage.get<Record<string, number>>("positions")) ?? {};
  }
  private async getStats(): Promise<AgentStats> {
    return (
      (await this.state.storage.get<AgentStats>("stats")) ?? {
        ticks: 0,
        opportunitiesEmitted: 0,
        alertsSent: 0,
        lastTickAt: null,
      }
    );
  }
  private async appendLog(entry: AgentLogEntry) {
    const log = await this.getLog();
    log.push(entry);
    while (log.length > MAX_LOG) log.shift();
    await this.state.storage.put("log", log);
  }
  private async appendDecision(d: AgentDecision) {
    const ds = await this.getDecisions();
    ds.push(d);
    while (ds.length > MAX_DECISIONS) ds.shift();
    await this.state.storage.put("decisions", ds);
  }

  /* ───────── HTTP entry (called by Worker) ───────── */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const op = url.pathname.replace("/__do/", "");

    if (op === "state") {
      const [meta, log, decisions, cooldowns, positions, stats] = await Promise.all([
        this.getMeta(),
        this.getLog(),
        this.getDecisions(),
        this.getCooldowns(),
        this.getPositions(),
        this.getStats(),
      ]);
      return Response.json({ ok: true, state: { meta, log, decisions, cooldowns, positions, stats } });
    }

    if (op === "reset") {
      await this.state.storage.deleteAll();
      await this.state.storage.deleteAlarm();
      return Response.json({ ok: true });
    }

    if (op === "message") {
      const message = (await request.json()) as AgentMessage;
      const result = await this.handleMessage(message);
      const meta = await this.getMeta();
      return Response.json({ ok: true, reply: result, meta });
    }

    return new Response("not found", { status: 404 });
  }

  /* ───────── Alarm = self-wake ───────── */
  async alarm() {
    // Self-tick. The agent decided when to wake itself up.
    await this.handleMessage({ kind: "tick", payload: { source: "alarm" } });
  }

  /* ───────── Message handlers ───────── */
  private async handleMessage(message: AgentMessage): Promise<unknown> {
    await this.appendLog({
      at: Date.now(),
      kind: message.kind,
      summary: `received:${message.kind}`,
      payload: message.payload,
    });

    switch (message.kind) {
      case "init":
        return this.onInit(message.payload as Partial<AgentMeta>);
      case "tick":
        return this.onTick();
      case "observe":
        return this.onObserve(message.payload);
      case "instruct":
        return this.onInstruct(message.payload as { text: string });
      case "shutdown":
        return this.onShutdown();
      default:
        return { ignored: true };
    }
  }

  private async onInit(payload: Partial<AgentMeta>): Promise<AgentMeta> {
    const existing = await this.getMeta();
    if (existing) return existing; // idempotent
    const now = Date.now();
    const meta: AgentMeta = {
      goal: payload.goal ?? "(no goal)",
      userId: payload.userId ?? null,
      walletAddress: payload.walletAddress ?? null,
      createdAt: now,
      ttlExpiresAt: payload.ttlExpiresAt ?? now + 7 * 24 * 60 * 60_000,
      tickIntervalMs: payload.tickIntervalMs ?? DEFAULT_TICK_MS,
    };
    await this.state.storage.put("meta", meta);
    // Schedule first alarm so the agent runs even with no external trigger
    await this.state.storage.setAlarm(now + meta.tickIntervalMs);
    return meta;
  }

  private async onTick(): Promise<{ ticked: true; nextAlarmAt: number | null; decided?: AgentDecision }> {
    const meta = await this.getMeta();
    if (!meta) return { ticked: true, nextAlarmAt: null };

    const now = Date.now();

    // TTL check — agent self-destructs after expiry.
    if (now >= meta.ttlExpiresAt) {
      await this.appendLog({ at: now, kind: "tick", summary: "ttl_expired_self_shutdown" });
      await this.onShutdown();
      return { ticked: true, nextAlarmAt: null };
    }

    // Bump stats + decide whether this tick produced anything actionable
    const stats = await this.getStats();
    stats.ticks += 1;
    stats.lastTickAt = now;

    const cooldowns = await this.getCooldowns();
    let decided: AgentDecision | undefined;

    // The actual reasoning is delegated to the brain — the DO posts a
    // tick-context payload to the brain's opportunity bus and the brain
    // (groq-triage → gemini-deep) handles deep reasoning. The DO's job is
    // STATE + SCHEDULING + ISOLATION, not LLM inference.
    const tickReason = `subagent_tick:${meta.goal.slice(0, 60)}`;
    const opEnvelope = {
      reason: tickReason,
      window: `${Math.round(meta.tickIntervalMs / 60_000)}m`,
      userId: meta.userId,
      source: "do_subagent",
      goal: meta.goal,
      walletAddress: meta.walletAddress,
      cooldowns,
      log: (await this.getLog()).slice(-10),
      observedAt: new Date(now).toISOString(),
    };

    let forwarded = false;
    try {
      const res = await fetch(`${this.env.DREYV_BRAIN_BASE_URL}/api/agents/ingest-tick`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opEnvelope),
      });
      forwarded = res.ok;
      if (res.ok) stats.opportunitiesEmitted += 1;
    } catch {
      forwarded = false;
    }

    decided = {
      at: now,
      op: "emit_tick_to_brain",
      rationale: forwarded ? "forwarded to brain ingest" : "brain unreachable; will retry next tick",
      forwarded,
    };
    await this.appendDecision(decided);
    await this.state.storage.put("stats", stats);

    // Schedule next tick. Always re-arm the alarm.
    const nextAlarmAt = now + meta.tickIntervalMs;
    await this.state.storage.setAlarm(nextAlarmAt);
    return { ticked: true, nextAlarmAt, decided };
  }

  private async onObserve(payload: unknown): Promise<{ observed: true }> {
    // Material chain event forwarded by the brain. Update positions/cooldowns
    // and optionally do an immediate tick if the event is urgent.
    const ev = (payload ?? {}) as { type?: string; mint?: string; amount?: number; urgent?: boolean };
    if (ev.mint && typeof ev.amount === "number") {
      const positions = await this.getPositions();
      positions[ev.mint] = ev.amount;
      await this.state.storage.put("positions", positions);
    }
    if (ev.urgent) {
      await this.onTick();
    }
    return { observed: true };
  }

  private async onInstruct(payload: { text: string }): Promise<{ stored: true }> {
    await this.appendLog({
      at: Date.now(),
      kind: "instruct",
      summary: payload.text.slice(0, 200),
    });
    return { stored: true };
  }

  private async onShutdown(): Promise<{ shutdown: true }> {
    await this.state.storage.deleteAll();
    await this.state.storage.deleteAlarm();
    return { shutdown: true };
  }
}
