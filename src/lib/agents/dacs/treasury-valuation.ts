/**
 * DACS Phase 7D.2 — Treasury valuation + burn-rate inference.
 *
 * Real on-chain reads — no demo figures. Per project rule, every output is
 * either backed by live data or surfaces "insufficient data" so the caller
 * can ask the user to provide the missing input.
 *
 *   1. valueTreasuryUsd(wallet, rpc) — Helius DAS `getAssetsByOwner` enriched
 *      with Jupiter price/v2 for SOL + every detected token; sums USD value.
 *   2. inferMonthlyBurnUsd(wallet, days=90) — sums net USD outflows from
 *      Helius enhanced-tx history over the window and projects to a 30-day
 *      figure. Stables priced at $1; SOL priced via current Jupiter price
 *      (a small approximation — historical Jupiter prices not available
 *      via the public API; surfaced in `notes`).
 */

import { fetchHeliusTransactions, type HeliusEnhancedTx } from "@/lib/agents/artifacts/helius";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLE_MINTS: Record<string, string> = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  PYUSD: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
  USDS: "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",
  DAI: "EjmyN6qEC1Tf1JxiG1ae7UTJhUxSwk1TCWNWqxWV4J6o",
};
const STABLE_MINT_SET = new Set(Object.values(STABLE_MINTS));

interface JupPriceMap {
  [mint: string]: { id: string; type?: string; price?: string | number };
}

async function fetchJupPrices(mints: string[]): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  const out: Record<string, number> = {};
  // Stables hard-pinned.
  for (const m of mints) if (STABLE_MINT_SET.has(m)) out[m] = 1;
  const remaining = mints.filter((m) => !(m in out));
  if (remaining.length === 0) return out;
  // Chunk to avoid URL-length issues (Jupiter accepts up to ~100 ids).
  for (let i = 0; i < remaining.length; i += 50) {
    const chunk = remaining.slice(i, i + 50);
    try {
      const url = `https://lite-api.jup.ag/price/v2?ids=${chunk.join(",")}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: JupPriceMap };
      const data = json.data ?? {};
      for (const [mint, row] of Object.entries(data)) {
        const p = typeof row?.price === "string" ? Number(row.price) : Number(row?.price ?? 0);
        if (Number.isFinite(p) && p > 0) out[mint] = p;
      }
    } catch {
      // partial price coverage is acceptable; missing mints contribute $0
    }
  }
  return out;
}

interface DasAsset {
  id: string;
  interface?: string;
  content?: { metadata?: { symbol?: string } };
  token_info?: {
    symbol?: string;
    decimals?: number;
    balance?: string | number;
    price_info?: { price_per_token?: number; total_price?: number };
  };
  ownership?: { owner?: string };
}

export interface TreasuryValuation {
  wallet: string;
  totalUsd: number;
  positions: Array<{ mint: string; symbol: string; amount: number; priceUsd: number; valueUsd: number }>;
  /** Mints we couldn't price (contribute $0 to total). */
  unpricedMints: string[];
  notes: string[];
}

export async function valueTreasuryUsd(opts: {
  wallet: string;
  rpcEndpoint: string;
}): Promise<TreasuryValuation> {
  const notes: string[] = [];
  const positions: TreasuryValuation["positions"] = [];

  // 1. Native SOL balance.
  let solAmount = 0;
  try {
    const r = await fetch(opts.rpcEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [opts.wallet] }),
      signal: AbortSignal.timeout(8_000),
    });
    const j = (await r.json()) as { result?: { value?: number } };
    solAmount = (j.result?.value ?? 0) / 1e9;
  } catch (e) {
    notes.push(`getBalance failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Token accounts via DAS.
  let dasAssets: DasAsset[] = [];
  try {
    const r = await fetch(opts.rpcEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAssetsByOwner",
        params: {
          ownerAddress: opts.wallet,
          page: 1,
          limit: 1000,
          displayOptions: { showFungible: true },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await r.json()) as { result?: { items?: DasAsset[] } };
    dasAssets = j.result?.items ?? [];
  } catch (e) {
    notes.push(`getAssetsByOwner failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const fungible = dasAssets.filter((a) => a.token_info && (a.token_info.balance ?? 0));
  const mintsToPrice: string[] = [SOL_MINT];
  for (const a of fungible) if (a.id) mintsToPrice.push(a.id);

  const prices = await fetchJupPrices(mintsToPrice);
  const unpriced: string[] = [];

  // SOL row
  const solPrice = prices[SOL_MINT] ?? 0;
  if (solPrice <= 0) unpriced.push(SOL_MINT);
  positions.push({
    mint: SOL_MINT,
    symbol: "SOL",
    amount: solAmount,
    priceUsd: solPrice,
    valueUsd: solAmount * solPrice,
  });

  for (const a of fungible) {
    const mint = a.id;
    const decimals = a.token_info?.decimals ?? 0;
    const rawBal = Number(a.token_info?.balance ?? 0);
    const amount = decimals > 0 ? rawBal / 10 ** decimals : rawBal;
    if (!(amount > 0)) continue;
    const symbol = a.token_info?.symbol || a.content?.metadata?.symbol || mint.slice(0, 4);
    const priceUsd = prices[mint] ?? a.token_info?.price_info?.price_per_token ?? 0;
    if (priceUsd <= 0) unpriced.push(mint);
    positions.push({ mint, symbol, amount, priceUsd, valueUsd: amount * priceUsd });
  }

  const totalUsd = positions.reduce((s, p) => s + (Number.isFinite(p.valueUsd) ? p.valueUsd : 0), 0);

  return { wallet: opts.wallet, totalUsd, positions, unpricedMints: unpriced, notes };
}

export interface BurnInference {
  wallet: string;
  windowDays: number;
  outflowUsd: number;
  inflowUsd: number;
  netOutflowUsd: number;
  monthlyBurnUsd: number;
  txCount: number;
  notes: string[];
}

/**
 * Infer monthly burn in USD from net outflows over `windowDays`. Stables
 * are priced at $1; non-stable token transfers are priced at the CURRENT
 * Jupiter price (historical Jupiter pricing isn't available via the
 * public API — surfaced in `notes`). Inflows subtracted so refills don't
 * understate burn.
 */
export async function inferMonthlyBurnUsd(opts: {
  wallet: string;
  windowDays?: number;
}): Promise<BurnInference> {
  const windowDays = Math.max(7, Math.min(365, opts.windowDays ?? 90));
  const sinceUnix = Math.floor(Date.now() / 1000) - windowDays * 86400;
  const notes: string[] = [];

  let txs: HeliusEnhancedTx[] = [];
  try {
    txs = await fetchHeliusTransactions(opts.wallet, { sinceUnix, limit: 2000 });
  } catch (e) {
    notes.push(`Helius fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Collect all mints we'll need to price (non-stables only).
  const nonStableMints = new Set<string>();
  for (const tx of txs) {
    for (const t of tx.tokenTransfers ?? []) {
      if (t.mint && !STABLE_MINT_SET.has(t.mint)) nonStableMints.add(t.mint);
    }
  }
  const prices = await fetchJupPrices([SOL_MINT, ...nonStableMints]);
  const solPrice = prices[SOL_MINT] ?? 0;
  if (solPrice <= 0) notes.push("SOL price unavailable; SOL flows treated as $0.");
  notes.push("Non-stable token flows priced at CURRENT Jupiter spot (no historical price API).");

  let outflowUsd = 0;
  let inflowUsd = 0;
  for (const tx of txs) {
    if (tx.transactionError) continue;
    // Native SOL transfers
    for (const n of tx.nativeTransfers ?? []) {
      const sol = (n.amount || 0) / 1e9;
      const usd = sol * solPrice;
      if (n.fromUserAccount === opts.wallet) outflowUsd += usd;
      if (n.toUserAccount === opts.wallet) inflowUsd += usd;
    }
    // SPL token transfers
    for (const t of tx.tokenTransfers ?? []) {
      const amount = Number(t.tokenAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const px = STABLE_MINT_SET.has(t.mint) ? 1 : prices[t.mint] ?? 0;
      const usd = amount * px;
      if (t.fromUserAccount === opts.wallet) outflowUsd += usd;
      if (t.toUserAccount === opts.wallet) inflowUsd += usd;
    }
  }

  const netOutflowUsd = Math.max(0, outflowUsd - inflowUsd);
  const monthlyBurnUsd = (netOutflowUsd / windowDays) * 30;

  return {
    wallet: opts.wallet,
    windowDays,
    outflowUsd,
    inflowUsd,
    netOutflowUsd,
    monthlyBurnUsd,
    txCount: txs.length,
    notes,
  };
}
