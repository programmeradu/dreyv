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
  alchemyFeed,
  covalentFeed,
  type DreyvEvent,
} from "@/lib/datafeeds";

const HOT_SYMBOLS = ["SOL", "ETH", "BTC", "JUP", "BONK", "WIF"];
const HOT_PYTH_IDS = [
  // Pyth price feed ids — kept tiny so tick10s stays cheap.
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", // SOL/USD
  "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", // ETH/USD
  "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", // BTC/USD
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
        all.push(...(await safeFetch("pyth", () => pythFeed.fetch({ priceIds: HOT_PYTH_IDS }))));
      }
      if (coingeckoFeed.isReady()) {
        all.push(...(await safeFetch("coingecko", () => coingeckoFeed.fetch({ symbols: HOT_SYMBOLS }))));
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
      if (!coingeckoFeed.isReady()) return [];
      return safeFetch("coingecko-broad", () =>
        coingeckoFeed.fetch({ symbols: [...HOT_SYMBOLS, "PYTH", "JTO", "PEPE", "ARB", "OP"] }),
      );
    });

    const chain = await step.run("chain-anomaly", async () => {
      const all: DreyvEvent[] = [];
      if (alchemyFeed.isReady()) {
        all.push(...(await safeFetch("alchemy", () => alchemyFeed.fetch({ network: "eth-mainnet" }))));
      }
      if (covalentFeed.isReady()) {
        all.push(...(await safeFetch("covalent", () => covalentFeed.fetch({ chainId: 1 }))));
      }
      return all;
    });

    const all = [...market, ...chain];
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
        all.push(...(await safeFetch("unlocks", () => tokenUnlocksFeed.fetch({ daysAhead: 30 }))));
      }
      if (exponentialFeed.isReady()) {
        all.push(...(await safeFetch("exponential", () => exponentialFeed.fetch({ limit: 20 }))));
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
