/**
 * DACS Phase 3 — Reflector post-mortem.
 *
 * When an approved plan fails during execution (or a tx-reconciler later
 * marks a submitted tx as failed/expired), we write a structured note into
 * `knowledge_entries` so the planner can recall it the next time the same
 * wallet asks for a similar action. This is intentionally narrow: just
 * enough context for the LLM to say "last time you tried X, it failed
 * because Y — propose Z instead."
 *
 * Best-effort: never throws into the executor's resume path.
 */

import { knowledgeMemory } from "@/lib/knowledge-memory";
import type { Intent, Plan } from "./types";

export interface PostMortemInput {
  commandId: string;
  walletAddress: string | null;
  intent: Intent;
  plan: Plan;
  failedCapabilityId: string | null;
  error: string;
  durationMs?: number;
  signature?: string | null;
}

export async function recordPostMortem(input: PostMortemInput): Promise<void> {
  try {
    const tags = [
      "dacs",
      "post-mortem",
      `intent:${input.intent.kind}`,
      ...(input.failedCapabilityId ? [`cap:${input.failedCapabilityId}`] : []),
      ...(input.walletAddress ? [`wallet:${input.walletAddress.slice(0, 8)}`] : []),
    ];

    const summary = input.failedCapabilityId
      ? `Approved plan failed at step "${input.failedCapabilityId}": ${input.error.slice(0, 240)}`
      : `Approved plan failed: ${input.error.slice(0, 240)}`;

    const content = JSON.stringify(
      {
        commandId: input.commandId,
        walletAddress: input.walletAddress,
        intentKind: input.intent.kind,
        intentEntities: input.intent.entities ?? null,
        plan: {
          steps: input.plan.steps.map((s) => ({
            capabilityId: s.capabilityId,
            input: s.input,
          })),
          rationale: input.plan.rationale,
          riskScore: input.plan.riskScore,
          estimatedValueUsd: input.plan.estimatedValueUsd,
        },
        failedCapabilityId: input.failedCapabilityId,
        error: input.error,
        durationMs: input.durationMs ?? null,
        signature: input.signature ?? null,
        recordedAt: new Date().toISOString(),
      },
      null,
      2,
    );

    await knowledgeMemory.store({
      source: "dacs_post_mortem",
      title: summary,
      summary,
      content,
      contentType: "json",
      tags,
      // Keep post-mortems for 90 days — long enough to bias planner, short
      // enough to avoid stale advice after protocols change.
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
  } catch (err) {
    console.warn("[dacs:post-mortem] failed to record (best-effort):", err);
  }
}
