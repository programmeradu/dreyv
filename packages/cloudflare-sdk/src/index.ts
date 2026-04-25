/**
 * @dreyv/cloudflare — unified Cloudflare SDK for Dreyv autonomous agents and Mini-Apps.
 *
 * Re-exports every module's namespace + types so consumers can do either:
 *   import { browser, workersAi, kv, d1, r2, agents } from "@dreyv/cloudflare";
 *   import { chat } from "@dreyv/cloudflare/workers-ai";
 */

export * from "./_internal";
export { browser } from "./browser";
export * as browserNs from "./browser";
export { workersAi } from "./workers-ai";
export * as workersAiNs from "./workers-ai";
export { kv } from "./kv";
export * as kvNs from "./kv";
export { d1 } from "./d1";
export * as d1Ns from "./d1";
export { r2 } from "./r2";
export * as r2Ns from "./r2";
export { agents } from "./agents";
export * as agentsNs from "./agents";
