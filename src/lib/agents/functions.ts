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
import { inngest } from "./inngest-client";
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
export const tick10s = inngest.createFunction(
  { id: "cadence-tick-10s", name: "Cadence • 10s market pulse" },
  { cron: "*/1 * * * *" }, // Inngest min cadence is 1m on free tier; we still emit 10s windows logically
  async ({ step }) => {
    const events = await step.run("fetch-hot-prices", async () => {
      const all: DreyvEvent[] = [];
      if (pythFeed.isReady()) {
        all.push(...(await safeFetch("pyth", () => pythFeed.fetch({ symbols: HOT_SYMBOLS }))));
      }
      if (coingeckoFeed.isReady()) {
        all.push(...(await safeFetch("coingecko", () => coingeckoFeed.fetch({ ids: HOT_CG_IDS }))));
      }
      return all;
    });
    return await step.run("publish", () => fanout(events));
  },
);

/* ---------------- sweep1m ---------------- */
export const sweep1m = inngest.createFunction(
  { id: "cadence-sweep-1m", name: "Cadence • 1m market + chain sweep" },
  { cron: "*/1 * * * *" },
  async ({ step }) => {
    const market = await step.run("market-sweep", async () => {
      if (!coingeckoFeed.isReady()) return [] as DreyvEvent[];
      return safeFetch("coingecko-broad", () => coingeckoFeed.fetch({ ids: BROAD_CG_IDS }));
    });

    // Note: Alchemy / Covalent feeds are address-scoped (wallet watch). They
    // run from the wallet/treasury watcher pipeline, not the market sweep.
    const all = market;
    const published = await step.run("publish", () => fanout(all));

    // Heuristic: any market move > 5% in window → opportunity surfaced.
    const movers = market.filter(
      (e) => e.kind === "market" && typeof e.changePct === "number" && Math.abs(e.changePct) >= 5,
    );
    if (movers.length) {
      await step.run("surface-opportunity", () =>
        publish({
          name: "agent.opportunity.surfaced",
          data: {
            reason: "fast_mover",
            window: "1m",
            movers,
            observedAt: new Date().toISOString(),
          },
        }),
      );
    }
    return { ...published, movers: movers.length };
  },
);

/* ---------------- deep5m ---------------- */
export const deep5m = inngest.createFunction(
  { id: "cadence-deep-5m", name: "Cadence • 5m yield + intel scan" },
  { cron: "*/5 * * * *" },
  async ({ step }) => {
    const yields = await step.run("yield-scan", () =>
      safeFetch("defillama", () => defiLlamaYields.fetch({ minTvlUsd: 1_000_000, limit: 30 })),
    );
    const intel = await step.run("intel-scan", async () => {
      const all: DreyvEvent[] = [];
      if (lunarCrushFeed.isReady()) {
        all.push(...(await safeFetch("lunarcrush", () => lunarCrushFeed.fetch({ symbols: HOT_SYMBOLS }))));
      }
      if (tokenUnlocksFeed.isReady()) {
        all.push(...(await safeFetch("unlocks", () => tokenUnlocksFeed.fetch({ withinDays: 30 }))));
      }
      if (exponentialFeed.isReady()) {
        all.push(...(await safeFetch("exponential", () => exponentialFeed.fetch({}))));
      }
      return all;
    });
    const all = [...yields, ...intel];
    const published = await step.run("publish", () => fanout(all));

    // Surface high-APY low-risk pools as opportunities.
    const juicy = yields.filter((e) => e.kind === "yield" && e.apy >= 15 && (e.riskScore ?? 100) < 60);
    if (juicy.length) {
      await step.run("surface-yield-opps", () =>
        publish({
          name: "agent.opportunity.surfaced",
          data: { reason: "yield", window: "5m", pools: juicy, observedAt: new Date().toISOString() },
        }),
      );
    }
    return { ...published, juicy: juicy.length };
  },
);

/* ---------------- reflect1h ---------------- */
export const reflect1h = inngest.createFunction(
  { id: "cadence-reflect-1h", name: "Cadence • 1h reflection loop" },
  { cron: "0 * * * *" },
  async ({ step }) => {
    return await step.run("reflect", () =>
      publish({
        name: "agent.self.proposed",
        data: {
          observedAt: new Date().toISOString(),
          summary:
            "Hourly reflection tick — downstream reflector agent should review last hour of opportunities, surfaced alerts, and propose strategy or sub-agent spawns.",
        },
      }),
    );
  },
);

export const ALL_FUNCTIONS = [tick10s, sweep1m, deep5m, reflect1h];
