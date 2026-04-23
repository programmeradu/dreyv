/**
 * Covalent multi-chain balance + transfer client.
 * Requires `COVALENT_API_KEY`. Used as a fallback / enrichment for Alchemy.
 * Docs: https://www.covalenthq.com/docs/api/
 */
import type { Chain, DataFeed, ChainEvent, DreyvEvent } from "./normalize";

const CHAIN_IDS: Record<Exclude<Chain, "solana" | "off-chain">, number> = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42_161,
  polygon: 137,
  bsc: 56,
};

export interface CovalentInput {
  chain: Exclude<Chain, "solana" | "off-chain">;
  address: string;
}

export const covalentFeed: DataFeed<CovalentInput> = {
  id: "covalent",
  isReady: () => Boolean(process.env.COVALENT_API_KEY),
  async fetch({ chain, address }) {
    const key = process.env.COVALENT_API_KEY;
    if (!key) return [];
    const id = CHAIN_IDS[chain];
    if (!id) return [];
    const url = `https://api.covalenthq.com/v1/${id}/address/${address}/balances_v2/?key=${key}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const items: any[] = data?.data?.items || [];
    const observedAt = new Date().toISOString();

    return items.slice(0, 100).map<ChainEvent>((it) => ({
      kind: "chain",
      observedAt,
      source: "covalent",
      chain,
      signatureOrHash: `${address}:${it?.contract_address}`,
      walletAddress: address,
      type: "transfer",
      amountUsd: typeof it?.quote === "number" ? it.quote : undefined,
      raw: it,
    })) as DreyvEvent[];
  },
};
