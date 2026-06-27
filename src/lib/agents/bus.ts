/**
 * Agent event bus.
 *
 * Phase 1 ships a thin wrapper that:
 *   1. Prefers Inngest when the connector secrets are present.
 *   2. Otherwise no-ops with a structured console log so dev still works.
 *
 * Phase 2 (durable functions) will subscribe to these event names. Keep names
 * stable: `<domain>.<noun>.<verb>`.
 */
import type { DreyvEvent } from "@/lib/datafeeds/normalize";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/inngest";

export type BusEventName =
  | "data.market.observed"
  | "data.chain.observed"
  | "data.yield.observed"
  | "data.intel.observed"
  | "wallet.tx.observed"
  | "agent.opportunity.surfaced"
  | "agent.proposal.created"
  | "agent.alert.raised"
  | "agent.report.ready"
  | "agent.self.proposed"
  | "subagent.spawn.requested"
  | "miniapp.spawn.requested"
  // DACS Phase 1
  | "agent.command.submitted"
  | "agent.intent.classified"
  | "agent.plan.synthesized"
  | "agent.plan.routed"
  | "agent.command.completed"
  // DACS Phase 2 — HITL queue
  | "agent.approval.requested"
  | "agent.approval.resolved"
  // DACS Phase 4 — sub-agent runtime
  | "agent.subagent.spawned"
  | "agent.subagent.tick"
  | "agent.subagent.completed"
  // DACS Phase 5 — multi-agent orchestration
  | "agent.handoff.requested"
  | "agent.handoff.reported"
  // Studio — video pipeline
  | "studio.video.render.requested";

export interface BusEnvelope<T = unknown> {
  name: BusEventName;
  data: T;
}

function inngestReady(): boolean {
  return Boolean(process.env.LOVABLE_API_KEY && process.env.INNGEST_API_KEY);
}

export async function publish(events: BusEnvelope | BusEnvelope[]): Promise<{
  delivered: boolean;
  reason?: string;
}> {
  const list = Array.isArray(events) ? events : [events];
  if (!list.length) return { delivered: true };

  if (!inngestReady()) {
    // Dev fallback: structured log so we can still trace flow.
    for (const e of list) {
      // eslint-disable-next-line no-console
      console.log("[bus:pending]", e.name, JSON.stringify(e.data).slice(0, 240));
    }
    return { delivered: false, reason: "inngest_not_linked" };
  }

  // Hard 8s timeout so a hung gateway can NEVER stall an Inngest step.
  // Fan-outs of 50+ publish() calls would otherwise blow the 5min function
  // timeout (root cause of past inngest/scheduled.timer failures).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${GATEWAY_URL}/e/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": process.env.INNGEST_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(list.length === 1 ? list[0] : list),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[bus:error]", res.status, body.slice(0, 200));
      return { delivered: false, reason: `gateway_${res.status}` };
    }
    return { delivered: true };
  } catch (e: any) {
    const reason = e?.name === "AbortError" ? "gateway_timeout_8s" : e?.message || "unknown";
    console.error("[bus:exception]", reason);
    return { delivered: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}

/** Convenience: publish a normalized DreyvEvent to its canonical bus name. */
export function publishDreyvEvent(evt: DreyvEvent) {
  const name: BusEventName =
    evt.kind === "market"
      ? "data.market.observed"
      : evt.kind === "chain"
        ? "data.chain.observed"
        : evt.kind === "yield"
          ? "data.yield.observed"
          : "data.intel.observed";
  return publish({ name, data: evt });
}
