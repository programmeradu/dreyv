/**
 * Cadence functions — the always-on heartbeat of the agent fabric.
 *
 *   tick10s   — fast market pulse (Pyth + CoinGecko hot symbols)
 *   sweep1m   — broader market + on-chain anomaly sweep
 *   deep5m    — yield + intel scan (DefiLlama, LunarCrush, Unlocks)
 *   reflect1h — reflection / self-improvement loop
 *
 * Each function reads from the data fabric (`readyFeeds()`), normalizes
 * results into `DreyvEvent`s, and republishes them on the bus so downstream
 * agents (opportunity, risk, treasury) can react. Missing API keys = the
 * relevant feed is skipped silently — no crashes.
 */
import { publish, publishDreyvEvent } from "./bus";
import {
  pythFeed,
  coingeckoFeed,
  defiLlamaYields,
  lunarCrushFeed,
  tokenUnlocksFeed,
  exponentialFeed,
  type DreyvEvent,
} from "@/lib/datafeeds";

const HOT_SYMBOLS = ["SOL", "ETH", "BTC", "JUP", "BONK", "WIF"];
const HOT_CG_IDS = [
  "solana",
  "ethereum",
  "bitcoin",
  "jupiter-exchange-solana",
  "bonk",
  "dogwifcoin",
];
const BROAD_CG_IDS = [
  ...HOT_CG_IDS,
  "pyth-network",
  "jito-governance-token",
  "pepe",
  "arbitrum",
  "optimism",
];

async function safeFetch<T>(label: string, fn: () => Promise<DreyvEvent[]>): Promise<DreyvEvent[]> {
  try {
    return await fn();
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn(`[cadence:${label}]`, e?.message || e);
    return [];
  }
}

async function fanout(events: DreyvEvent[]) {
  if (!events.length) return { published: 0 };
  await Promise.all(events.map((e) => publishDreyvEvent(e)));
  return { published: events.length };
}

/* ---------------- tick10s ---------------- */
export async function handleTick10s() {
  const all: DreyvEvent[] = [];
  if (pythFeed.isReady()) {
    all.push(...(await safeFetch("pyth", () => pythFeed.fetch({ symbols: HOT_SYMBOLS }))));
  }
  if (coingeckoFeed.isReady()) {
    all.push(...(await safeFetch("coingecko", () => coingeckoFeed.fetch({ ids: HOT_CG_IDS }))));
  }
  return await fanout(all);
}

/* ---------------- sweep1m ---------------- */
export async function handleSweep1m() {
  let market: DreyvEvent[] = [];
  if (coingeckoFeed.isReady()) {
    market = await safeFetch("coingecko-broad", () => coingeckoFeed.fetch({ ids: BROAD_CG_IDS }));
  }

  const all = market;
  const published = await fanout(all);

  // Heuristic: any market move > 5% in window → opportunity surfaced.
  const movers = market.filter(
    (e) => e.kind === "market" && typeof e.changePct === "number" && Math.abs(e.changePct) >= 5,
  );
  if (movers.length) {
    await publish({
      name: "agent.opportunity.surfaced",
      data: {
        reason: "fast_mover",
        window: "1m",
        movers,
        observedAt: new Date().toISOString(),
      },
    });
  }
  return { ...published, movers: movers.length };
}

/* ---------------- deep5m ---------------- */
export async function handleDeep5m() {
  const yields = await safeFetch("defillama", () => defiLlamaYields.fetch({ minTvlUsd: 1_000_000, limit: 30 }));
  
  const intel: DreyvEvent[] = [];
  if (lunarCrushFeed.isReady()) {
    intel.push(...(await safeFetch("lunarcrush", () => lunarCrushFeed.fetch({ symbols: HOT_SYMBOLS }))));
  }
  if (tokenUnlocksFeed.isReady()) {
    intel.push(...(await safeFetch("unlocks", () => tokenUnlocksFeed.fetch({ withinDays: 30 }))));
  }
  if (exponentialFeed.isReady()) {
    intel.push(...(await safeFetch("exponential", () => exponentialFeed.fetch({}))));
  }

  const all = [...yields, ...intel];
  const published = await fanout(all);

  // Surface high-APY low-risk pools as opportunities.
  const juicy = yields.filter((e) => e.kind === "yield" && e.apy >= 15 && (e.riskScore ?? 100) < 60);
  if (juicy.length) {
    await publish({
      name: "agent.opportunity.surfaced",
      data: { reason: "yield", window: "5m", pools: juicy, observedAt: new Date().toISOString() },
    });
  }
  return { ...published, juicy: juicy.length };
}

/* ---------------- reflect1h ---------------- */
export async function handleReflect1h() {
  return await publish({
    name: "agent.self.proposed",
    data: {
      observedAt: new Date().toISOString(),
      summary:
        "Hourly reflection tick — downstream reflector agent should review last hour of opportunities, surfaced alerts, and propose strategy or sub-agent spawns.",
    },
  });
}

// Inngest registry is empty now since these moved to CF Cron
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ALL_FUNCTIONS: any[] = [];
