/**
 * Exponential.fi risk feed. Public read endpoint (no key for basic queries).
 * Returns risk grades for DeFi pools. Used to enrich YieldEvent risk scores.
 *
 * If Exponential changes their public endpoint we degrade gracefully (return []).
 */
import type { DataFeed, DreyvEvent, IntelEvent } from "./normalize";

const URL_BASE = "https://api.exponential.fi/pools";

export interface ExponentialInput {
  pools?: string[];
}

export const exponentialFeed: DataFeed<ExponentialInput> = {
  id: "exponential",
  isReady: () => true,
  async fetch({ pools = [] } = {}) {
    try {
      const res = await fetch(URL_BASE, { cache: "no-store" });
      if (!res.ok) return [];
      const data = await res.json().catch(() => null);
      const items: any[] = Array.isArray(data) ? data : data?.items || [];
      const observedAt = new Date().toISOString();
      const wanted = new Set(pools);
      const filtered = pools.length
        ? items.filter((p) => wanted.has(String(p?.id)))
        : items.slice(0, 50);

      return filtered.map<IntelEvent>((p) => ({
        kind: "intel",
        observedAt,
        source: "exponential",
        topic: "other",
        summary: `Risk grade ${p?.riskGrade ?? "?"} for ${p?.name ?? p?.id}`,
        payload: p,
      })) as DreyvEvent[];
    } catch {
      return [];
    }
  },
};
