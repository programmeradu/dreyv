/**
 * Data fabric registry. Scanner / Inngest functions iterate over this list,
 * skipping any feed whose `isReady()` returns false (missing keys).
 */
export * from "./normalize";
export { pythFeed } from "./pyth";
export { defiLlamaYields } from "./defillama";
export { coingeckoFeed } from "./coingecko";
export { exponentialFeed } from "./exponential";
export { alchemyFeed, getLatestBlock } from "./alchemy";
export { covalentFeed } from "./covalent";
export { lunarCrushFeed } from "./lunarcrush";
export { tokenUnlocksFeed } from "./tokenunlocks";

import type { DataFeed } from "./normalize";
import { pythFeed } from "./pyth";
import { defiLlamaYields } from "./defillama";
import { coingeckoFeed } from "./coingecko";
import { exponentialFeed } from "./exponential";
import { alchemyFeed } from "./alchemy";
import { covalentFeed } from "./covalent";
import { lunarCrushFeed } from "./lunarcrush";
import { tokenUnlocksFeed } from "./tokenunlocks";

export const DATA_FEEDS: DataFeed<any>[] = [
  pythFeed,
  defiLlamaYields,
  coingeckoFeed,
  exponentialFeed,
  alchemyFeed,
  covalentFeed,
  lunarCrushFeed,
  tokenUnlocksFeed,
];

export function readyFeeds(): DataFeed<any>[] {
  return DATA_FEEDS.filter((f) => f.isReady());
}
