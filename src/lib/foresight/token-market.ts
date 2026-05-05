import type { SimulationIR, IRToken } from "@/lib/foresight/simulation-ir";
import { TOKEN_MINTS } from "@/lib/agents/capabilities/tokens";

const STABLE = new Set(["USDC", "USDT", "DAI", "BUSD", "TUSD", "USDP", "FRAX", "PYUSD", "EURC", "USDS"]);

const WELL_KNOWN: Record<string, { mint: string; name: string; logo: string; price?: number }> = {
  SOL: { mint: TOKEN_MINTS.SOL, name: "Solana", logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" },
  USDC: { mint: TOKEN_MINTS.USDC, name: "USD Coin", logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png", price: 1 },
  USDT: { mint: TOKEN_MINTS.USDT, name: "Tether USD", logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg", price: 1 },
  JTO: { mint: TOKEN_MINTS.JTO, name: "Jito", logo: "https://metadata.jito.network/token/jto/icon.png" },
  JUP: { mint: TOKEN_MINTS.JUP, name: "Jupiter", logo: "https://static.jup.ag/jup/icon.png" },
  BONK: { mint: TOKEN_MINTS.BONK, name: "Bonk", logo: "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I" },
  MSOL: { mint: TOKEN_MINTS.MSOL, name: "Marinade SOL", logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png" },
  JITOSOL: { mint: TOKEN_MINTS.JITOSOL, name: "JitoSOL", logo: "https://storage.googleapis.com/token-metadata/JitoSOL-256.png" },
  BSOL: { mint: TOKEN_MINTS.BSOL, name: "BlazeStake SOL", logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1/logo.png" },
};

function symbolsRequiredByScenario(ir: SimulationIR): string[] {
  const out = new Set<string>();
  for (const r of ir.rebalances) Object.keys(r.targetAllocationPct || {}).forEach((s) => out.add(s.toUpperCase()));
  for (const s of ir.shocks) if (s.symbol !== "*") out.add(s.symbol.toUpperCase());
  for (const y of ir.yields) if (y.symbol !== "*") out.add(y.symbol.toUpperCase());
  for (const f of ir.flows) if (f.symbol) out.add(f.symbol.toUpperCase());
  return [...out];
}

async function fetchDexByMint(mints: string[]) {
  const byMint: Record<string, Partial<IRToken> & { name?: string }> = {};
  if (!mints.length) return byMint;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints.join(",")}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return byMint;
    const data = await res.json();
    for (const pair of data?.pairs || []) {
      const mint = pair?.baseToken?.address;
      if (!mint || !mints.includes(mint)) continue;
      const liquidity = Number(pair?.liquidity?.usd || 0);
      const existingLiquidity = Number((byMint[mint] as any)?.liquidity || 0);
      if (byMint[mint]?.price && liquidity <= existingLiquidity) continue;
      byMint[mint] = {
        mint,
        symbol: String(pair.baseToken.symbol || "").toUpperCase(),
        name: pair.baseToken.name,
        price: Number(pair.priceUsd || 0),
        logo: pair.info?.imageUrl,
        change24h: Number(pair.priceChange?.h24 || 0),
        ...(liquidity ? { liquidity } as any : {}),
      };
    }
  } catch {
    return byMint;
  }
  return byMint;
}

export async function enrichIRWithScenarioAssets(ir: SimulationIR): Promise<SimulationIR> {
  const existing = new Map(ir.startState.tokens.map((t) => [String(t.symbol).toUpperCase(), t]));
  const wanted = symbolsRequiredByScenario(ir).filter((s) => !existing.has(s));
  if (!wanted.length) return ir;

  const mints = wanted.map((s) => WELL_KNOWN[s]?.mint || TOKEN_MINTS[s]).filter(Boolean);
  const dex = await fetchDexByMint(mints);
  const additions: IRToken[] = [];
  const unknowns = new Set(ir.unknowns || []);

  for (const symbol of wanted) {
    const known = WELL_KNOWN[symbol];
    const mint = known?.mint || TOKEN_MINTS[symbol];
    const live = mint ? dex[mint] : null;
    const price = STABLE.has(symbol) ? 1 : Number(live?.price || known?.price || 0);
    if (!mint || price <= 0) {
      unknowns.add(`${symbol} price unavailable — ask user for a live price or choose a priced asset`);
      continue;
    }
    additions.push({
      symbol,
      amount: 0,
      price,
      mint,
      logo: live?.logo || known?.logo,
      change24h: typeof live?.change24h === "number" ? live.change24h : 0,
      isStable: STABLE.has(symbol),
      name: known?.name || (live as any)?.name,
    } as IRToken);
  }

  return {
    ...ir,
    startState: {
      ...ir.startState,
      tokens: [...ir.startState.tokens, ...additions],
    },
    unknowns: [...unknowns],
  };
}