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
  | "miniapp.spawn.requested";

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

  try {
    const res = await fetch(`${GATEWAY_URL}/e/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": process.env.INNGEST_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(list.length === 1 ? list[0] : list),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.error("[bus:error]", res.status, body.slice(0, 200));
      return { delivered: false, reason: `gateway_${res.status}` };
    }
    return { delivered: true };
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[bus:exception]", e?.message || e);
    return { delivered: false, reason: e?.message || "unknown" };
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
