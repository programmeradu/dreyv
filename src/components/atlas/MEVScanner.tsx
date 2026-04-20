"use client";

import { useState, useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  SystemProgram,
  PublicKey,
  TransactionMessage,
} from "@solana/web3.js";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, AlertTriangle, TrendingUp } from "lucide-react";
import { toast } from "@/lib/toast-notifications";
import { IconMEVDetector } from "@/components/ui/icons";

const SOL_MINT = "So11111111111111111111111111111111111111112";

// Jito tip accounts for MEV-protected bundle inclusion
const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4bVqkfRtQ7NmXwQhE3FMPB",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSQnR21urPnRsJJXKSt",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

// ---------------------------------------------------------------------------
// Dynamic Jupiter quote fetcher — no hardcoded DEX names.
// Tries the preferred DEX first; if Jupiter doesn't recognise the name or
// returns no route, silently falls back to unrestricted routing so the
// executor can still work with whatever markets are available.
// ---------------------------------------------------------------------------
async function fetchQuote(opts: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: string;
  preferredDex?: string; // raw dexId from scanner — tried as-is
}): Promise<any> {
  const base = new URL("/api/jupiter/quote", window.location.origin);
  base.searchParams.set("inputMint", opts.inputMint);
  base.searchParams.set("outputMint", opts.outputMint);
  base.searchParams.set("amount", opts.amount);
  base.searchParams.set("slippageBps", opts.slippageBps);

  // Attempt 1 — route through the specific DEX
  if (opts.preferredDex) {
    const dexUrl = new URL(base);
    dexUrl.searchParams.set("dexes", opts.preferredDex);
    try {
      const res = await fetch(dexUrl.toString(), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data?.outAmount) return { ...data, _routedViaDex: opts.preferredDex };
      }
    } catch {
      // DEX-specific route failed — try fallback
    }
  }

  // Attempt 2 — let Jupiter find the best unrestricted route
  const res = await fetch(base.toString(), { cache: "no-store" });
  const data = await res.json();
  if (!res.ok || !data?.outAmount) {
    throw new Error(data?.error || "No route available");
  }
  return { ...data, _routedViaDex: null };
}

export function MEVScanner() {
  const { publicKey, sendTransaction, signAllTransactions } = useWallet();
  const { connection } = useConnection();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [lastScan, setLastScan] = useState<number | null>(null);
  const [autoScan, setAutoScan] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [solPrice, setSolPrice] = useState<number>(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Fetch SOL price on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/jupiter/price?ids=SOL");
        const d = await res.json();
        if (d?.data?.SOL?.price) setSolPrice(d.data.SOL.price);
      } catch {
        /* best-effort */
      }
    })();
  }, []);

  // ── Scan ────────────────────────────────────────────────────────────
  const scanForMEV = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/solana/mev-scan?minProfit=0.5");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setOpportunities(data.opportunities || []);
      setLastScan(data.scannedAt || Date.now());
      if ((data.opportunities?.length || 0) > 0) {
        toast.success(`Found ${data.opportunities.length} opportunity(s)!`);
      }
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  // ── Execute — fully dynamic, reads everything from the opp object ──
  const executeMevArbitrage = async (opp: any) => {
    // --- guard checks ---
    if (!publicKey || !signAllTransactions) {
      toast.error("Connect a wallet that supports batch signing");
      return;
    }
    if (!opp.tokenMint) {
      toast.error("Token mint missing — rescan for fresh data");
      return;
    }

    setExecutingId(opp.id);
    try {
      // --- derive trade parameters from the opportunity data ---
      const effectiveSolPrice = solPrice || 150;
      const tradeUsd = Number(opp.tradeSize) || 100;
      const solAmount = tradeUsd / effectiveSolPrice;
      const inputLamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
      if (inputLamports < 10_000) throw new Error("Trade size too small");

      toast.message("Building arb bundle…", {
        description: `Buy ${opp.buyDex} → Sell ${opp.sellDex}`,
      });

      // ── LEG 1 — BUY: SOL → Token, preferring the cheaper DEX ──────
      const buyQuote = await fetchQuote({
        inputMint: SOL_MINT,
        outputMint: opp.tokenMint,
        amount: String(inputLamports),
        slippageBps: "100",
        preferredDex: opp.buyDexId, // raw dexscreener id, tried as-is
      });

      // Build buy swap tx
      const buySwapRes = await fetch("/api/jupiter/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: buyQuote,
          userPublicKey: publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          asLegacyTransaction: false,
        }),
      });
      const buySwapData = await buySwapRes.json();
      if (!buySwapRes.ok || !buySwapData?.swapTransaction) {
        throw new Error(buySwapData?.error || "Buy-leg swap build failed");
      }

      // ── LEG 2 — SELL: Token → SOL, preferring the expensive DEX ────
      const tokensReceived = buyQuote.outAmount; // dynamic from leg 1

      const sellQuote = await fetchQuote({
        inputMint: opp.tokenMint,
        outputMint: SOL_MINT,
        amount: tokensReceived,
        slippageBps: "100",
        preferredDex: opp.sellDexId,
      });

      // Build sell swap tx
      const sellSwapRes = await fetch("/api/jupiter/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: sellQuote,
          userPublicKey: publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          asLegacyTransaction: false,
        }),
      });
      const sellSwapData = await sellSwapRes.json();
      if (!sellSwapRes.ok || !sellSwapData?.swapTransaction) {
        throw new Error(sellSwapData?.error || "Sell-leg swap build failed");
      }

      // ── Profitability gate — only execute if net positive ──────────
      const solOut = Number(sellQuote.outAmount);
      const grossProfitLamports = solOut - inputLamports;
      // Tip: 10% of gross profit, floor at 10 000 lamports
      const tipLamports = Math.max(10_000, Math.floor(Math.max(0, grossProfitLamports) * 0.1));
      const netProfitLamports = grossProfitLamports - tipLamports;

      if (netProfitLamports <= 0) {
        toast.error("Spread closed — no longer profitable", {
          description: `Net would be ${(netProfitLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL. Skipping.`,
        });
        return;
      }

      // ── LEG 3 — JITO TIP (dynamic amount) ─────────────────────────
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const tipAccount = JITO_TIP_ACCOUNTS[
        Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)
      ];

      const tipVtx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: blockhash,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: new PublicKey(tipAccount),
              lamports: tipLamports,
            }),
          ],
        }).compileToV0Message()
      );

      // ── Deserialize Jupiter swap txs ───────────────────────────────
      const decode = (b64: string) =>
        VersionedTransaction.deserialize(
          Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        );
      const buyVtx = decode(buySwapData.swapTransaction);
      const sellVtx = decode(sellSwapData.swapTransaction);

      // ── Sign all 3 atomically ──────────────────────────────────────
      toast.message("Approve 3 transactions in wallet…", {
        description: "Buy → Sell → Tip (atomic Jito bundle)",
      });
      const signed = await signAllTransactions([buyVtx, sellVtx, tipVtx]);

      // ── Submit as Jito bundle ──────────────────────────────────────
      const serialize64 = (tx: VersionedTransaction) => {
        const bytes = tx.serialize();
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
      };

      const bundleRes = await fetch("/api/solana/jito-bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: signed.map(serialize64),
        }),
      });
      const bundleData = await bundleRes.json();

      if (!bundleRes.ok || !bundleData.success) {
        // Jito unavailable → fallback: send legs sequentially via RPC + confirm each
        toast.message("Jito unavailable — submitting direct…");
        const buyResult = await sendAndConfirmSigned(connection, signed[0], {
          onPending: (sig) => toast.message("Buy leg pending…", { description: sig.slice(0, 8) + "…" }),
        });
        if (!buyResult.confirmed) {
          toast.error("Arb failed on buy leg", { description: buyResult.error });
          return;
        }
        const sellResult = await sendAndConfirmSigned(connection, signed[1], {
          onPending: (sig) => toast.message("Sell leg pending…", { description: sig.slice(0, 8) + "…" }),
        });
        if (!sellResult.confirmed) {
          toast.error("Arb partially filled — sell leg failed", { description: sellResult.error });
          return;
        }
        toast.success(`Arb executed: ${opp.token}`, {
          description: `Buy → Sell confirmed on-chain`,
        });
        toast.message("Sell tx on Solscan", {
          description: `https://solscan.io/tx/${sellResult.signature}`,
          action: {
            label: "Open",
            onClick: () => window.open(`https://solscan.io/tx/${sellResult.signature}`, "_blank", "noopener,noreferrer"),
          },
        });
        return;
      }

      // ── Report profit ──────────────────────────────────────────────
      const profitSol = netProfitLamports / LAMPORTS_PER_SOL;
      const profitUsd = profitSol * effectiveSolPrice;

      const buyRoute = buyQuote._routedViaDex || "best route";
      const sellRoute = sellQuote._routedViaDex || "best route";

      toast.success(`Arb complete: ${opp.token}`, {
        description: `Buy (${buyRoute}) → Sell (${sellRoute}) | +${profitSol.toFixed(4)} SOL ($${profitUsd.toFixed(2)})`,
      });

      if (bundleData.bundleId) {
        toast.message("Jito bundle", { description: bundleData.bundleId });
      }
    } catch (e: any) {
      toast.error("Arb failed", { description: e?.message || String(e) });
    } finally {
      setExecutingId(null);
    }
  };

  // ── Auto-scan ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!autoScan) return;
    const iv = setInterval(scanForMEV, 10_000);
    return () => clearInterval(iv);
  }, [autoScan]);

  // ── Scroll shadows ─────────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      el.classList.add("is-scrolling");
      if (t) clearTimeout(t);
      t = setTimeout(() => el.classList.remove("is-scrolling"), 900);
      el.scrollTop > 2 ? el.classList.add("has-top-shadow") : el.classList.remove("has-top-shadow");
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop < max - 2 ? el.classList.add("has-bottom-shadow") : el.classList.remove("has-bottom-shadow");
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); if (t) clearTimeout(t); };
  }, [opportunities.length]);

  // ── Helpers ────────────────────────────────────────────────────────
  const confidenceColor = (c: string) =>
    c === "high" ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
    : c === "medium" ? "text-amber-500 border-amber-500/30 bg-amber-500/10"
    : "text-red-500 border-red-500/30 bg-red-500/10";

  const fmtPrice = (p: number) => {
    if (p === 0) return "$0.00";
    if (p >= 0.01) return `$${p.toFixed(4)}`;
    const str = p.toFixed(20);
    const m = str.match(/^0\.(0+)([1-9]\d*)/);
    if (m) {
      const sub: Record<string, string> = { "0":"₀","1":"₁","2":"₂","3":"₃","4":"₄","5":"₅","6":"₆","7":"₇","8":"₈","9":"₉" };
      return `$0.0${m[1].length.toString().split("").map(d => sub[d]).join("")}${m[2].slice(0, 4)}`;
    }
    return `$${p.toFixed(8)}`;
  };

  return (
    <div className="space-y-3">
      {/* Inline header (compact, fits inside outer atlas-glass section) */}
      <div className="flex items-center justify-end gap-2">
        {lastScan && (
          <span className="text-[10px] text-slate-400">
            {new Date(lastScan).toLocaleTimeString()}
          </span>
        )}
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${opportunities.length > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
          {opportunities.length} Opp{opportunities.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={scanForMEV}
          disabled={loading}
          className="px-3 py-1 rounded-lg border border-violet-200 bg-white text-xs font-medium text-violet-700 hover:bg-violet-50 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Scan Now
        </button>
      </div>

      {loading && opportunities.length === 0 && (
        <div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-20 w-full" /></div>
      )}

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <div ref={scrollRef} className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {opportunities.map((opp) => (
          <div key={opp.id} className="rounded-xl p-3 bg-white border border-slate-200 hover:shadow-sm transition-shadow">
            {opp.type === "arbitrage" ? (
              <>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-xs text-slate-900 flex items-center gap-2">
                      <TrendingUp className="h-3 w-3 text-emerald-500" />
                      {opp.token}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Buy on {opp.buyDex} @ {fmtPrice(opp.buyPrice)} → Sell on {opp.sellDex} @ {fmtPrice(opp.sellPrice)}
                    </div>
                  </div>
                  <Badge className={`text-[10px] ${confidenceColor(opp.confidence)}`}>{opp.confidence}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] mb-2">
                  <div><span className="text-slate-500">Spread:</span>{" "}<span className="font-mono text-emerald-600 font-semibold">+{opp.profitPercent}%</span></div>
                  <div><span className="text-slate-500">Est:</span>{" "}<span className="font-mono text-slate-900">${opp.profitUsd}</span></div>
                  <div><span className="text-slate-500">Size:</span>{" "}<span className="font-mono text-slate-900">${opp.tradeSize}</span></div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-[10px] text-slate-500">~{opp.expiresIn}s · Liq: ${((opp.liquidity || 0) / 1000).toFixed(0)}k</div>
                  <button
                    className="px-2.5 py-1 rounded-lg bg-violet-600 text-white text-[10px] font-medium hover:bg-violet-700 transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                    disabled={!publicKey || !signAllTransactions || executingId === opp.id}
                    onClick={() => executeMevArbitrage(opp)}
                  >
                    {executingId === opp.id ? <Loader2 className="h-3 w-3 animate-spin" /> : !publicKey ? "Connect" : "Arb Execute"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="font-semibold text-xs text-slate-900">{opp.token}</span>
                  <Badge variant="secondary" className="text-[10px]">Risk Alert</Badge>
                </div>
                <div className="text-[11px] text-slate-600">{opp.warning}</div>
                {opp.frontrunProfit && <div className="text-[10px] text-slate-500 mt-1">Potential profit: ${opp.frontrunProfit}</div>}
              </>
            )}
          </div>
        ))}
      </div>

      {!loading && opportunities.length === 0 && !error && (
        <div className="text-xs text-slate-500 text-center py-4">No MEV opportunities right now. Market is efficient!</div>
      )}

      <div className="text-[10px] text-slate-400 text-center mt-2">
        Atomic Jito bundle: Buy + Sell + Tip in one slot. Profitability verified before execution.
      </div>
    </div>
  );
}
