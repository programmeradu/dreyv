/**
 * Phase 14 / Block B Step 1 — periodic treasury snapshot writer.
 *
 * Every 15 minutes:
 *   1. Collect every distinct vault/wallet address we track:
 *      - `teams.vaultAddress`  (Squads vaults attached to teams)
 *      - `orgVaults.vaultAddress` (organization-level vaults)
 *      - `txWatchedWallets.walletAddress` (user-watched wallets)
 *   2. For each wallet, fetch holdings via Helius DAS + native SOL balance.
 *   3. Price each asset via Pyth (with stablecoin assumption + Coingecko fallback).
 *   4. Insert one `treasury_snapshots` row per wallet (idempotent: the
 *      `POST /api/treasury/snapshots` route throttles same-wallet writes
 *      under 60s; here we throttle to 14 min on the watcher side as well
 *      so a manual refresh + cron tick can't double-write).
 *
 * Without this watcher, `treasury_snapshots` only fills up when the user
 * manually opens /app/analytics — the trend curve stays flat. With it,
 * every vault gets a fresh USD valuation point every 15 minutes for the
 * Foresight engine and the analytics chart.
 */

import { inngest } from "../inngest-client";
import { db } from "@/db";
import {
  teams,
  orgVaults,
  txWatchedWallets,
  treasurySnapshots,
} from "@/db/schema";
import { and, desc, eq, isNotNull, sql as dsql } from "drizzle-orm";
import { Connection, PublicKey } from "@solana/web3.js";
import { resolveUserIdFromWallet } from "@/lib/agents/brains/storage";
import { pythFeed, PYTH_FEED_IDS } from "@/lib/datafeeds/pyth";
import { coingeckoFeed } from "@/lib/datafeeds/coingecko";

const HELIUS_API_KEY = process.env.HELIUS_API_KEY ?? "";
const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  (HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}` : null) ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

const STABLES = new Set([
  "USDC", "USDT", "DAI", "BUSD", "TUSD", "USDP", "FRAX", "LUSD", "PYUSD",
  "GUSD", "USDD", "CUSD", "SUSD", "EURC",
]);

interface TokenSlice {
  symbol: string;
  mint: string;
  amount: number;
  priceUsd: number;
  valueUsd: number;
  isStable: boolean;
}

// ─── Holding fetch ────────────────────────────────────────────────────

async function fetchHoldings(address: string): Promise<{
  sol: number;
  tokens: { mint: string; symbol: string; amount: number }[];
}> {
  if (!HELIUS_API_KEY) {
    // Fallback: bare-RPC native SOL balance only (no token enrichment).
    try {
      const conn = new Connection(RPC_URL, "confirmed");
      const lamports = await conn.getBalance(new PublicKey(address));
      return { sol: lamports / 1e9, tokens: [] };
    } catch {
      return { sol: 0, tokens: [] };
    }
  }

  const body = {
    jsonrpc: "2.0",
    id: "snapshot-watcher",
    method: "getAssetsByOwner",
    params: {
      ownerAddress: address,
      page: 1,
      limit: 200,
      displayOptions: { showFungible: true, showNativeBalance: true },
    },
  };

  let sol = 0;
  let tokens: { mint: string; symbol: string; amount: number }[] = [];
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const items: any[] = data?.result?.items ?? [];

    // Native SOL — exposed by DAS at result.nativeBalance.lamports
    const nativeLamports = Number(data?.result?.nativeBalance?.lamports ?? 0);
    sol = Number.isFinite(nativeLamports) ? nativeLamports / 1e9 : 0;

    tokens = items
      .filter((it) => it.interface === "FungibleToken" || it.interface === "FungibleAsset")
      .map((it) => {
        const decimals = Number(it.token_info?.decimals ?? 0);
        const rawBalance = Number(it.token_info?.balance ?? 0);
        const amount = decimals > 0 ? rawBalance / Math.pow(10, decimals) : rawBalance;
        const symbol =
          (it.token_info?.symbol as string | undefined) ||
          (it.content?.metadata?.symbol as string | undefined) ||
          "UNKNOWN";
        return { mint: String(it.id), symbol: symbol.toUpperCase(), amount };
      })
      .filter((t) => t.amount > 0);
  } catch (e) {
    console.warn(`[snapshots] DAS fetch failed for ${address}:`, e);
  }

  return { sol, tokens };
}

// ─── Pricing ──────────────────────────────────────────────────────────

const PRICE_TTL_MS = 60_000;
const priceCache = new Map<string, { ts: number; usd: number }>();

async function priceSymbols(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const now = Date.now();
  const need: string[] = [];

  // Cache hit + automatic stable peg
  for (const sRaw of symbols) {
    const s = sRaw.toUpperCase();
    if (STABLES.has(s)) {
      out.set(s, 1);
      continue;
    }
    const cached = priceCache.get(s);
    if (cached && now - cached.ts < PRICE_TTL_MS) {
      out.set(s, cached.usd);
      continue;
    }
    if (PYTH_FEED_IDS[s]) need.push(s);
  }

  // Pyth (preferred — deeper liquidity, tighter freshness)
  if (need.length) {
    try {
      const events = (await pythFeed.fetch({ symbols: need })) as any[];
      for (const ev of events) {
        if (ev?.symbol && Number.isFinite(ev?.priceUsd)) {
          out.set(ev.symbol, ev.priceUsd);
          priceCache.set(ev.symbol, { ts: now, usd: ev.priceUsd });
        }
      }
    } catch (e) {
      console.warn("[snapshots] pyth price fetch failed:", e);
    }
  }

  // Coingecko fallback for SOL only (cheap, public, rate-limit safe at 15min cadence)
  if (!out.has("SOL")) {
    try {
      const events = (await coingeckoFeed.fetch({ ids: ["solana"] })) as any[];
      const sol = events.find((e: any) => e?.symbol === "SOLANA");
      if (sol && Number.isFinite(sol.priceUsd)) {
        out.set("SOL", sol.priceUsd);
        priceCache.set("SOL", { ts: now, usd: sol.priceUsd });
      }
    } catch {
      /* swallow */
    }
  }

  return out;
}

// ─── Snapshot one wallet ─────────────────────────────────────────────

async function snapshotWallet(address: string, vaultHint?: string | null): Promise<{
  ok: boolean;
  totalUsd?: number;
  reason?: string;
}> {
  if (!db) return { ok: false, reason: "no-db" };

  // Throttle: skip if a snapshot was written in the last 14 min for this wallet.
  // (POST /api/treasury/snapshots throttles to 60s; the cron throttles to 14m
  // so a manual refresh between cron ticks doesn't get smothered.)
  const recent = await db
    .select({ id: treasurySnapshots.id, capturedAt: treasurySnapshots.capturedAt })
    .from(treasurySnapshots)
    .where(eq(treasurySnapshots.walletAddress, address))
    .orderBy(desc(treasurySnapshots.capturedAt))
    .limit(1);
  if (recent[0] && Date.now() - new Date(recent[0].capturedAt).getTime() < 14 * 60_000) {
    return { ok: true, reason: "throttled" };
  }

  const { sol, tokens } = await fetchHoldings(address);
  if (sol === 0 && tokens.length === 0) {
    return { ok: false, reason: "empty-wallet" };
  }

  const allSymbols = ["SOL", ...tokens.map((t) => t.symbol)];
  const prices = await priceSymbols(allSymbols);

  const composition: TokenSlice[] = [];

  if (sol > 0) {
    const p = prices.get("SOL") ?? 0;
    composition.push({
      symbol: "SOL",
      mint: "So11111111111111111111111111111111111111112",
      amount: sol,
      priceUsd: p,
      valueUsd: sol * p,
      isStable: false,
    });
  }

  for (const t of tokens) {
    const p = prices.get(t.symbol) ?? (STABLES.has(t.symbol) ? 1 : 0);
    if (p === 0) continue; // Skip unpriced tokens; we'd rather under-report than fabricate.
    composition.push({
      symbol: t.symbol,
      mint: t.mint,
      amount: t.amount,
      priceUsd: p,
      valueUsd: t.amount * p,
      isStable: STABLES.has(t.symbol),
    });
  }

  const totalUsd = composition.reduce((s, t) => s + t.valueUsd, 0);
  const stableUsd = composition.filter((t) => t.isStable).reduce((s, t) => s + t.valueUsd, 0);
  const volatileUsd = totalUsd - stableUsd;

  if (totalUsd <= 0) {
    return { ok: false, reason: "unpriced" };
  }

  const userId = await resolveUserIdFromWallet(address).catch(() => null);

  await db.insert(treasurySnapshots).values({
    userId: userId ?? null,
    walletAddress: address,
    vaultAddress: vaultHint ?? null,
    totalUsd: String(totalUsd),
    stableUsd: String(stableUsd),
    volatileUsd: String(volatileUsd),
    yieldUsd: "0",
    composition: composition as unknown as object,
    source: "inngest",
  });

  return { ok: true, totalUsd };
}

// ─── Watcher (every 15 minutes) ──────────────────────────────────────

export const treasurySnapshotsWatcher = inngest.createFunction(
  {
    id: "treasury-snapshots-watcher",
    name: "Treasury · Snapshots (every 15m)",
    concurrency: { limit: 1, key: "global" },
    retries: 1,
  },
  { cron: "*/15 * * * *" },
  async ({ step, logger }) => {
    if (!db) return { skipped: "no-db" };

    const wallets = await step.run("collect-wallets", async () => {
      const set = new Map<string, string | null>(); // address -> vaultHint

      // 1) Squads vaults attached to teams
      try {
        const teamRows = await db!
          .select({ vaultAddress: teams.vaultAddress })
          .from(teams)
          .where(isNotNull(teams.vaultAddress));
        for (const r of teamRows) {
          if (r.vaultAddress) set.set(r.vaultAddress, r.vaultAddress);
        }
      } catch (e) {
        logger?.warn?.("[snapshots] team vault scan failed", e);
      }

      // 2) Org vaults
      try {
        const orgRows = await db!
          .select({ vaultAddress: orgVaults.vaultAddress })
          .from(orgVaults);
        for (const r of orgRows) {
          if (r.vaultAddress) set.set(r.vaultAddress, r.vaultAddress);
        }
      } catch {
        /* table may not exist on every branch */
      }

      // 3) Active watched wallets (user EOAs)
      try {
        const watched = await db!
          .select({ wallet: txWatchedWallets.walletAddress })
          .from(txWatchedWallets)
          .where(eq(txWatchedWallets.active, true));
        for (const r of watched) {
          if (r.wallet && !set.has(r.wallet)) set.set(r.wallet, null);
        }
      } catch {
        /* swallow */
      }

      return Array.from(set.entries()).map(([address, vaultHint]) => ({ address, vaultHint }));
    });

    if (wallets.length === 0) {
      return { snapshotted: 0, reason: "no-wallets" };
    }

    let written = 0;
    let throttled = 0;
    let failed = 0;
    let empty = 0;

    // Process serially with a small gap to be a good citizen on Helius/Pyth.
    for (const { address, vaultHint } of wallets) {
      try {
        const r = await snapshotWallet(address, vaultHint);
        if (r.ok && r.totalUsd) written++;
        else if (r.reason === "throttled") throttled++;
        else if (r.reason === "empty-wallet") empty++;
        else failed++;
      } catch (e) {
        failed++;
        logger?.warn?.(`[snapshots] failed for ${address}`, e);
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    return {
      total: wallets.length,
      written,
      throttled,
      empty,
      failed,
    };
  },
);
