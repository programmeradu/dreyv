/**
 * Brain router — listens for `agent.opportunity.surfaced`, runs Groq triage,
 * and on `escalate` calls Gemini deep reasoning. Emits `agent.proposal.created`
 * or `agent.alert.raised`, and may request sub-agent spawns via the reflector.
 */
import { inngest } from "../inngest-client";
import { publish } from "../bus";
import { triageOpportunity, type OpportunitySummary } from "./groq-triage";
import { deepReason } from "./gemini-deep";
import { maybeSpawnFromProposal } from "./reflector";

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
      await step.run("emit-alert", () =>
        publish({
          name: "agent.alert.raised",
          data: {
            level: "info",
            title: triage.reason,
            tags: triage.tags,
            triage,
            opp,
            observedAt: new Date().toISOString(),
          },
        }),
      );
      return { verdict: "watch" };
    }

    const proposal = await step.run("gemini-deep", () => deepReason(opp, triage));

    await step.run("emit-proposal", () =>
      publish({
        name: proposal.kind === "proposal" ? "agent.proposal.created" : "agent.alert.raised",
        data: { proposal, triage, opp, observedAt: new Date().toISOString() },
      }),
    );

    const spawn = await step.run("maybe-spawn", () => maybeSpawnFromProposal(proposal));
    return { verdict: "escalate", kind: proposal.kind, spawned: spawn.spawned };
  },
);

export const reflectorListener = inngest.createFunction(
  { id: "brains-reflector-tick", name: "Brains • Reflector tick" },
  { event: "agent.self.proposed" },
  async ({ step }) => {
    // Phase 3 stub — Phase 4 will pull last-hour proposals from durable storage
    // and decide which patterns deserve a persistent sub-agent.
    return await step.run("noop", async () => ({ ok: true }));
  },
);

export const BRAIN_FUNCTIONS = [opportunityRouter, reflectorListener];
