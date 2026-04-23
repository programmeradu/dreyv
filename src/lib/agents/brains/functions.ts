/**
 * Brain router — listens for `agent.opportunity.surfaced`, runs Groq triage,
 * and on `escalate` calls Gemini deep reasoning. Emits `agent.proposal.created`
 * or `agent.alert.raised`, persists every emitted item to the proposals
 * inbox, and may request sub-agent spawns via the reflector.
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
} from "./storage";

export const opportunityRouter = inngest.createFunction(
  { id: "brains-opportunity-router", name: "Brains • Opportunity router" },
  { event: "agent.opportunity.surfaced" },
  async ({ event, step }) => {
    const opp = (event.data ?? {}) as OpportunitySummary;

    const triage = await step.run("groq-triage", () => triageOpportunity(opp));

    if (triage.verdict === "drop") {
      return { verdict: "drop", reason: triage.reason };
    }

    if (triage.verdict === "watch") {
      const persisted = await step.run("persist-alert", () => saveAlertOnly({ triage, opp }));
      await step.run("emit-alert", () =>
        publish({
          name: "agent.alert.raised",
          data: {
            level: "info",
            title: triage.reason,
            tags: triage.tags,
            triage,
            opp,
            proposalId: persisted?.id ?? null,
            observedAt: new Date().toISOString(),
          },
        }),
      );
      return { verdict: "watch", proposalId: persisted?.id ?? null };
    }

    const proposal = await step.run("gemini-deep", () => deepReason(opp, triage));

    const persisted = await step.run("persist-proposal", () =>
      savePropagatedProposal({ proposal, triage, opp }),
    );

    await step.run("emit-proposal", () =>
      publish({
        name: proposal.kind === "proposal" ? "agent.proposal.created" : "agent.alert.raised",
        data: {
          proposal,
          triage,
          opp,
          proposalId: persisted?.id ?? null,
          observedAt: new Date().toISOString(),
        },
      }),
    );

    const spawn = await step.run("maybe-spawn", () => maybeSpawnFromProposal(proposal));
    return {
      verdict: "escalate",
      kind: proposal.kind,
      proposalId: persisted?.id ?? null,
      spawned: spawn.spawned,
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
    const spec = event.data as SubAgentSpec;
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

export const reflectorListener = inngest.createFunction(
  { id: "brains-reflector-tick", name: "Brains • Reflector tick" },
  { event: "agent.self.proposed" },
  async ({ step }) => {
    // Phase 5 will pull last-hour proposals from durable storage and
    // decide which patterns deserve a persistent sub-agent.
    return await step.run("noop", async () => ({ ok: true }));
  },
);

export const BRAIN_FUNCTIONS = [
  opportunityRouter,
  subAgentSpawner,
  subAgentReaper,
  reflectorListener,
];
