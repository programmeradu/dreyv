/**
 * Live vault context for the benchmark.
 *
 * Fetches a REAL Solana treasury via Helius DAS + RPC at run time and
 * formats it as ground-truth context for every model under test. No more
 * fictional fixture — what you see in the prompt is what's on-chain right
 * now for the configured address.
 *
 * Configure with `BENCHMARK_VAULT_ADDRESS` (defaults to the Marinade DAO
 * realm: 899YG3yk4F66ZgbNWLHriZHTXSKk9e1kvsKEquW7L6Mo).
 *
 * Pricing: pulled from the Helius DAS `price_info` field where available,
 * with a Jupiter Price API fallback. SOL native balance comes from
 * `getBalance`.
 */

const DEFAULT_VAULT = "899YG3yk4F66ZgbNWLHriZHTXSKk9e1kvsKEquW7L6Mo"; // Marinade DAO realm
const SOL_MINT = "So11111111111111111111111111111111111111112";

export interface LiveHolding {
  symbol: string;
  mint: string;
  amount: number;
  decimals: number;
  priceUsd: number | null;
  usd: number | null;
}

export interface LiveVaultSnapshot {
  address: string;
  label: string;
  asOf: string;
  totalUsd: number;
  solBalance: number;
  holdings: LiveHolding[]; // sorted desc by USD
  fungibleCount: number;
  nftCount: number;
  nftSample: { name: string; mint: string }[];
  source: "helius" | "fallback";
  warning?: string;
}

interface DasAsset {
  id: string;
  interface?: string;
  content?: { metadata?: { name?: string; symbol?: string } };
  token_info?: {
    symbol?: string;
    balance?: number | string;
    decimals?: number;
    price_info?: { price_per_token?: number; total_price?: number };
  };
}

async function heliusRpc(apiKey: string, method: string, params: unknown): Promise<any> {
  const url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "benchmark", method, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Helius ${method} ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(`Helius ${method}: ${json.error?.message || JSON.stringify(json.error)}`);
  return json.result;
}

export async function buildLiveVaultSnapshot(addressOverride?: string): Promise<LiveVaultSnapshot> {
  const address = addressOverride || process.env.BENCHMARK_VAULT_ADDRESS || DEFAULT_VAULT;
  const apiKey = process.env.HELIUS_API_KEY;
  const asOf = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";

  if (!apiKey) {
    return {
      address, label: "Unknown vault", asOf, totalUsd: 0, solBalance: 0,
      holdings: [], fungibleCount: 0, nftCount: 0, nftSample: [],
      source: "fallback", warning: "HELIUS_API_KEY not configured — no live data available",
    };
  }

  // Pull SOL native balance + DAS getAssetsByOwner in parallel.
  const [solLamports, dasResult] = await Promise.all([
    heliusRpc(apiKey, "getBalance", [address]).then((r: any) => Number(r?.value || 0)).catch(() => 0),
    heliusRpc(apiKey, "getAssetsByOwner", {
      ownerAddress: address,
      page: 1,
      limit: 1000,
      displayOptions: { showFungible: true, showNativeBalance: true, showZeroBalance: false },
    }).catch((e: Error) => ({ items: [], _err: e.message })),
  ]);

  const items: DasAsset[] = (dasResult?.items as DasAsset[]) || [];
  const solBalance = solLamports / 1e9;

  // Try DAS native balance for SOL price; fall back to Jupiter for SOL price.
  let solPrice: number | null = (dasResult as any)?.nativeBalance?.price_per_sol ?? null;
  if (solPrice == null) {
    try {
      const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`, { cache: "no-store" });
      const j = await r.json();
      solPrice = Number(j?.[SOL_MINT]?.usdPrice) || null;
    } catch { /* ignore */ }
  }

  const holdings: LiveHolding[] = [];
  if (solBalance > 0) {
    holdings.push({
      symbol: "SOL", mint: SOL_MINT, amount: solBalance, decimals: 9,
      priceUsd: solPrice, usd: solPrice ? solBalance * solPrice : null,
    });
  }

  let nftCount = 0;
  const nftSample: { name: string; mint: string }[] = [];
  const fungibleMintsMissingPrice: string[] = [];

  for (const it of items) {
    const isFungible = it.interface === "FungibleToken" || it.interface === "FungibleAsset" || !!it.token_info;
    if (!isFungible) {
      nftCount++;
      if (nftSample.length < 5) {
        const name = it.content?.metadata?.name || it.id.slice(0, 8);
        nftSample.push({ name, mint: it.id });
      }
      continue;
    }
    const ti = it.token_info!;
    const decimals = ti.decimals ?? 0;
    const rawBal = typeof ti.balance === "string" ? Number(ti.balance) : ti.balance ?? 0;
    const amount = rawBal / 10 ** decimals;
    if (amount <= 0) continue;
    const symbol = ti.symbol || it.content?.metadata?.symbol || it.id.slice(0, 4);
    let priceUsd = ti.price_info?.price_per_token ?? null;
    let usd = ti.price_info?.total_price ?? (priceUsd ? amount * priceUsd : null);
    if (priceUsd == null) fungibleMintsMissingPrice.push(it.id);
    holdings.push({ symbol, mint: it.id, amount, decimals, priceUsd, usd });
  }

  // Best-effort: top up missing prices via Jupiter for the largest gaps.
  if (fungibleMintsMissingPrice.length) {
    try {
      const ids = fungibleMintsMissingPrice.slice(0, 50).join(",");
      const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${ids}`, { cache: "no-store" });
      const j = (await r.json()) as Record<string, { usdPrice?: number }>;
      for (const h of holdings) {
        if (h.usd == null && j?.[h.mint]?.usdPrice) {
          h.priceUsd = Number(j[h.mint].usdPrice);
          h.usd = h.amount * h.priceUsd;
        }
      }
    } catch { /* ignore */ }
  }

  holdings.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  const totalUsd = holdings.reduce((s, h) => s + (h.usd || 0), 0);
  const fungibleCount = holdings.length;

  return {
    address,
    label: address === DEFAULT_VAULT ? "Marinade DAO Realm" : address.slice(0, 6) + "…" + address.slice(-4),
    asOf,
    totalUsd,
    solBalance,
    holdings,
    fungibleCount,
    nftCount,
    nftSample,
    source: "helius",
    warning: (dasResult as any)?._err ? `DAS error: ${(dasResult as any)._err}` : undefined,
  };
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return "$" + Math.round(n).toLocaleString();
}
function fmtAmt(n: number, decimals: number): string {
  const d = decimals > 6 ? 4 : Math.min(decimals, 4);
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

export function renderVaultContext(snap: LiveVaultSnapshot): string {
  const lines: string[] = [];
  lines.push(
    "LIVE_TREASURY_CONTEXT (live on-chain snapshot — treat as ground truth, do NOT ask the user to connect a wallet, the address is already known):",
    "",
    `Vault label: ${snap.label}`,
    `Address: ${snap.address}`,
    `As of: ${snap.asOf}`,
    `Source: ${snap.source === "helius" ? "Helius DAS + RPC mainnet" : "fallback (no live source available)"}`,
    `Total priced value: ${fmtUsd(snap.totalUsd)} across ${snap.fungibleCount} fungible position(s) + ${snap.nftCount} NFT(s)`,
    "",
  );
  if (snap.warning) lines.push(`Note: ${snap.warning}`, "");

  if (snap.holdings.length) {
    lines.push("Holdings (top 25 by USD):");
    for (const h of snap.holdings.slice(0, 25)) {
      const pct = snap.totalUsd > 0 && h.usd ? ` (${((h.usd / snap.totalUsd) * 100).toFixed(1)}%)` : "";
      lines.push(`- ${fmtAmt(h.amount, h.decimals)} ${h.symbol} ≈ ${fmtUsd(h.usd)}${pct} · mint ${h.mint}`);
    }
    lines.push("");
  } else {
    lines.push("Holdings: (none returned by Helius for this address)", "");
  }

  if (snap.nftSample.length) {
    lines.push(`NFT sample (${snap.nftCount} total):`);
    for (const n of snap.nftSample) lines.push(`- ${n.name} (${n.mint.slice(0, 8)}…)`);
    lines.push("");
  }

  lines.push(
    "Use this snapshot to answer concrete questions directly with real numbers. ",
    "If a question requires data not present above (historical PnL, validator delegations, off-chain flows, fees, future projections), say so plainly and explain what you would need — do NOT invent figures.",
  );
  return lines.join("\n");
}
