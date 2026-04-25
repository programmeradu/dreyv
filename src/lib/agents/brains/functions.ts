/**
 * Brain router — listens for `agent.opportunity.surfaced`, runs Groq triage,
 * and on `escalate` calls Gemini deep reasoning. Emits `agent.proposal.created`
 * or `agent.alert.raised`, persists every emitted item to the proposals
 * inbox (scoped by `userId` when the surfacing source provided one), and may
 * request sub-agent spawns via the reflector.
 *
 * Phase 5 additions:
 *   - opportunities can carry a `userId` for wallet-scoped routing
 *   - `treasuryWatch5m` cadence sweeps registered watchers and surfaces
 *     user-scoped opportunities from balance deltas
 *   - `subAgentTick` re-runs each active sub-agent's goal hourly to
 *     emit follow-up proposals
 */
import { inngest } from "../inngest-client";
import { publish } from "../bus";
import { triageOpportunity, type OpportunitySummary } from "./groq-triage";
import { deepReason } from "./gemini-deep";
import { maybeSpawnFromProposal, type SubAgentSpec } from "./reflector";
import {
  savePropagatedProposal,
  saveAlertOnly,
  saveSubAgentSpec,
  expireSubAgents,
  expireStaleTxProposals,
} from "./storage";
import { bridgeProposalToTx } from "./executor-bridge";
import { reconcileSubmittedTxProposals } from "./tx-reconciler";
import { pollJitoOnce } from "../jito-poller";
import { sendAgent, subagentInstance, isAgentWorkerConfigured } from "../agent-client";
import {
  listWatchers,
  scanWatcher,
  diffSnapshots,
  recordScan,
  type WatcherSnapshot,
} from "./watchers";
import { db } from "@/db";
import { agentSubagents } from "@/db/schema";
import { eq } from "drizzle-orm";

type OppWithUser = OpportunitySummary & { userId?: string | null };

export const opportunityRouter = inngest.createFunction(
  { id: "brains-opportunity-router", name: "Brains • Opportunity router" },
  { event: "agent.opportunity.surfaced" },
  async ({ event, step }) => {
    const opp = (event.data ?? {}) as OppWithUser;
    const userId = opp.userId ?? null;

    const triage = await step.run("groq-triage", () => triageOpportunity(opp));

    if (triage.verdict === "drop") {
      return { verdict: "drop", reason: triage.reason };
    }

    if (triage.verdict === "watch") {
      const persisted = await step.run("persist-alert", () =>
        saveAlertOnly({ triage, opp, userId }),
      );
      await step.run("emit-alert", () =>
        publish({
          name: "agent.alert.raised",
          data: {
            level: "info",
            title: triage.reason,
            tags: triage.tags,
            triage,
            opp,
            userId,
            proposalId: persisted?.id ?? null,
            observedAt: new Date().toISOString(),
          },
        }),
      );
      return { verdict: "watch", proposalId: persisted?.id ?? null };
    }

    const proposal = await step.run("gemini-deep", () => deepReason(opp, triage));

    const persisted = await step.run("persist-proposal", () =>
      savePropagatedProposal({ proposal, triage, opp, userId }),
    );

    await step.run("emit-proposal", () =>
      publish({
        name: proposal.kind === "proposal" ? "agent.proposal.created" : "agent.alert.raised",
        data: {
          proposal,
          triage,
          opp,
          userId,
          proposalId: persisted?.id ?? null,
          observedAt: new Date().toISOString(),
        },
      }),
    );

    const spawn = await step.run("maybe-spawn", () => maybeSpawnFromProposal(proposal, userId));

    // Phase 6: high-confidence proposals get queued as HITL transactions.
    const queued = await step.run("bridge-to-tx", () =>
      bridgeProposalToTx({
        proposalId: persisted?.id ?? null,
        userId,
        proposal,
      }),
    );

    return {
      verdict: "escalate",
      kind: proposal.kind,
      proposalId: persisted?.id ?? null,
      spawned: spawn.spawned,
      queuedTxId: queued?.id ?? null,
    };
  },
);

/**
 * Sub-agent spawn handler — persists the spec so it shows up in the
 * inbox / agent roster. The actual per-agent loop lives in `subAgentTick`.
 */
export const subAgentSpawner = inngest.createFunction(
  { id: "brains-subagent-spawner", name: "Brains • Sub-agent spawner" },
  { event: "subagent.spawn.requested" },
  async ({ event, step }) => {
    const spec = event.data as SubAgentSpec & { userId?: string | null };
    const ok = await step.run("persist-subagent", () => saveSubAgentSpec(spec));
    return { ok, id: spec.id };
  },
);

/**
 * Expire sub-agents whose TTL elapsed. Runs every 10 minutes.
 */
export const subAgentReaper = inngest.createFunction(
  { id: "brains-subagent-reaper", name: "Brains • Sub-agent reaper" },
  { cron: "*/10 * * * *" },
  async ({ step }) => {
    const expired = await step.run("expire-subagents", () => expireSubAgents());
    return { expired };
  },
);

/**
 * Sub-agent execution loop — every 30 minutes each active sub-agent
 * gets a "tick": we re-run its goal as a fresh opportunity carrying
 * its userId, which flows back through the brain pipeline. This is the
 * persistent autonomy loop — sub-agents stay alive and keep proposing
 * until they expire or are dismissed.
 */
export const subAgentTick = inngest.createFunction(
  { id: "brains-subagent-tick", name: "Brains • Sub-agent tick" },
  { cron: "*/30 * * * *" },
  async ({ step }) => {
    const active = await step.run("load-active", async () => {
      const empty: Array<{ id: string; name: string; goal: string; userId: string | null }> = [];
      if (!db) return empty;
      try {
        const rows = await db
          .select({
            id: agentSubagents.id,
            name: agentSubagents.name,
            goal: agentSubagents.goal,
            userId: agentSubagents.userId,
          })
          .from(agentSubagents)
          .where(eq(agentSubagents.status, "active"))
          .limit(50);
        return rows;
      } catch (err: any) {
        // Degrade gracefully if the table hasn't been migrated yet
        // (e.g. fresh deploy before 0008_agent_subagents.sql is applied).
        if (err?.code === "42P01") {
          console.warn("[subAgentTick] agent_subagents table missing — skipping tick. Apply scripts/migrations/0008_agent_subagents.sql.");
          return empty;
        }
        throw err;
      }
    });

    if (!active.length) return { ticked: 0 };

    // Hybrid execution:
    //  - If the Cloudflare Agent Worker is configured, send a `tick` message
    //    to each sub-agent's Durable Object. Each DO has its own private
    //    memory, will reason against its own log, and post back through
    //    /api/agents/ingest-tick if it has anything material.
    //  - Otherwise, fall back to the original behavior of publishing one
    //    bus event per sub-agent so the brain still triages something.
    // Either way we chunk + Promise.allSettled so one slow call can never
    // stall the whole step (this was the root cause of the previous 5min
    // timeouts that were killing inngest/scheduled.timer).
    const useDO = isAgentWorkerConfigured();
    const results = await step.run("emit-ticks", async () => {
      const CHUNK = 10;
      let ok = 0;
      let failed = 0;
      for (let i = 0; i < active.length; i += CHUNK) {
        const slice = active.slice(i, i + CHUNK);
        const settled = await Promise.allSettled(
          slice.map(async (a) => {
            if (useDO) {
              // Idempotent init (DO ignores if already initialized) → tick.
              await sendAgent(subagentInstance(a.id), {
                kind: "init",
                payload: { goal: a.goal, userId: a.userId, walletAddress: null },
              });
              return sendAgent(subagentInstance(a.id), { kind: "tick" });
            }
            return publish({
              name: "agent.opportunity.surfaced",
              data: {
                reason: `subagent_tick:${a.name}`,
                window: "30m",
                userId: a.userId,
                source: "subagent",
                subagentId: a.id,
                goal: a.goal,
                observedAt: new Date().toISOString(),
              },
            });
          }),
        );
        for (const r of settled) {
          if (r.status === "fulfilled") ok += 1;
          else failed += 1;
        }
      }
      return { ok, failed, mode: useDO ? "durable_object" : "bus_fallback" };
    });

    return { ticked: active.length, ...results };
  },
);

/**
 * Treasury watcher — every 5 minutes sweep all active watchers,
 * snapshot balances, diff against the previous snapshot, and surface
 * a user-scoped opportunity when movement is material.
 */
export const treasuryWatch5m = inngest.createFunction(
  { id: "brains-treasury-watch-5m", name: "Brains • Treasury watch (5m)" },
  { cron: "*/5 * * * *" },
  async ({ step }) => {
    const watchers = await step.run("load-watchers", () => listWatchers({ activeOnly: true }));
    if (!watchers.length) return { scanned: 0, surfaced: 0 };

    let surfaced = 0;
    for (const w of watchers) {
      const snap = (await step.run(`scan-${w.id}`, () => scanWatcher(w))) as WatcherSnapshot | null;
      if (!snap) continue;
      const prev = (w.lastSnapshot as WatcherSnapshot | null) ?? null;
      const diff = diffSnapshots(prev, snap);
      await step.run(`record-${w.id}`, () => recordScan(w.id, snap));
      if (!diff.material) continue;
      surfaced += 1;
      await step.run(`surface-${w.id}`, () =>
        publish({
          name: "agent.opportunity.surfaced",
          data: {
            reason: `treasury_${diff.reason}`,
            window: "5m",
            userId: w.userId,
            source: "treasury_watcher",
            watcherId: w.id,
            chain: w.chain,
            address: w.address,
            label: w.label,
            deltaPct: diff.deltaPct,
            snapshot: snap,
            observedAt: new Date().toISOString(),
          },
        }),
      );
    }
    return { scanned: watchers.length, surfaced };
  },
);

export const reflectorListener = inngest.createFunction(
  { id: "brains-reflector-tick", name: "Brains • Reflector tick" },
  { event: "agent.self.proposed" },
  async ({ step }) => {
    return await step.run("noop", async () => ({ ok: true }));
  },
);

/**
 * Expire queued tx proposals past their TTL. Runs every 10 minutes alongside
 * the sub-agent reaper so stale "approve me" cards drop out of the inbox.
 */
export const txProposalReaper = inngest.createFunction(
  { id: "brains-tx-proposal-reaper", name: "Brains • Tx proposal reaper" },
  { cron: "*/10 * * * *" },
  async ({ step }) => {
    const expired = await step.run("expire-tx", () => expireStaleTxProposals());
    return { expired };
  },
);

/**
 * Reconcile `submitted` tx proposals against on-chain status every 5 min so
 * rows don't get stranded when the user closes the tab mid-confirmation.
 */
export const txProposalReconciler = inngest.createFunction(
  { id: "brains-tx-proposal-reconciler", name: "Brains • Tx proposal reconciler" },
  { cron: "*/5 * * * *" },
  async ({ step }) => {
    return await step.run("reconcile-tx", () => reconcileSubmittedTxProposals());
  },
);

/**
 * Jito MEV poller — every 2 minutes, samples Jito tip-floor stats and
 * surfaces an `agent.opportunity.surfaced` if MEV pressure is unusual.
 * Cheap (one HTTP call) and complements the Helius webhook stream.
 */
export const jitoMevPoll = inngest.createFunction(
  { id: "jito-mev-poll-2m", name: "Jito MEV poll (2m)" },
  { cron: "*/2 * * * *" },
  async ({ step }) => {
    const surfaced = await step.run("poll-jito", () => pollJitoOnce());
    return { surfaced };
  },
);

export const BRAIN_FUNCTIONS = [
  opportunityRouter,
  subAgentSpawner,
  subAgentReaper,
  subAgentTick,
  treasuryWatch5m,
  reflectorListener,
  txProposalReaper,
  txProposalReconciler,
  jitoMevPoll,
];
