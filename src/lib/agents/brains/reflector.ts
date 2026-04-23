/**
 * Reflector — turns recurring proposals/alerts and the hourly reflection tick
 * into sub-agent spawn specs. The actual spawn execution lives in Phase 4
 * (durable sub-agent runtime); here we shape the spec and emit
 * `subagent.spawn.requested` so the bus is the source of truth.
 */
import { publish } from "../bus";
import type { DeepProposal } from "./gemini-deep";

export interface SubAgentSpec {
  id: string; // deterministic-ish id
  name: string;
  goal: string;
  triggers: Array<{
    event:
      | "data.market.observed"
      | "data.chain.observed"
      | "data.yield.observed"
      | "data.intel.observed"
      | "wallet.tx.observed";
    filter?: Record<string, unknown>;
  }>;
  capabilities: Array<"read_market" | "read_yield" | "alert" | "propose_action">;
  ttlMinutes: number;
  parent: "reflector" | "deep" | "manual";
  notes?: string;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

export function specFromProposal(p: DeepProposal): SubAgentSpec | null {
  // Only spawn when the deep model itself asked for it.
  const wantsSpawn = p.actions.some((a) => a.op === "spawn_subagent");
  if (!wantsSpawn && p.confidence < 0.75) return null;

  const seed = `${slug(p.title)}-${Date.now().toString(36)}`;
  return {
    id: `sa_${seed}`,
    name: p.title.slice(0, 48),
    goal: p.thesis.slice(0, 400),
    triggers: [{ event: "data.market.observed" }],
    capabilities: ["read_market", "read_yield", "alert", "propose_action"],
    ttlMinutes: p.horizon === "minutes" ? 30 : p.horizon === "hours" ? 240 : 1440,
    parent: "deep",
    notes: `Spawned from deep proposal (model=${p.model}, conf=${p.confidence.toFixed(2)}).`,
  };
}

export async function maybeSpawnFromProposal(p: DeepProposal) {
  const spec = specFromProposal(p);
  if (!spec) return { spawned: false };
  await publish({ name: "subagent.spawn.requested", data: spec });
  return { spawned: true, spec };
}
