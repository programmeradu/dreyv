"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ArrowLeftRight } from "lucide-react";

/**
 * Curated token list shown as quick-select chips above the Jupiter widget.
 * Mints match the rest of the Atlas codebase (LST_OPTIONS, MINTS, etc.).
 */
const CURATED_TOKENS: { symbol: string; mint: string }[] = [
  { symbol: "SOL", mint: "So11111111111111111111111111111111111111112" },
  { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
  { symbol: "JUP", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { symbol: "BONK", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { symbol: "JTO", mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL" },
  { symbol: "WIF", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { symbol: "PYTH", mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  { symbol: "mSOL", mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So" },
  { symbol: "JitoSOL", mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn" },
];

const STORAGE_KEY = "atlas:swap:lastPair";

type Pair = { input: string; output: string };

const DEFAULT_PAIR: Pair = {
  input: CURATED_TOKENS[0].mint,
  output: CURATED_TOKENS[1].mint,
};

function readStoredPair(): Pair | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.input && parsed?.output) return parsed as Pair;
  } catch {
    /* ignore */
  }
  return null;
}

function symbolFor(mint: string): string {
  return CURATED_TOKENS.find((t) => t.mint === mint)?.symbol || mint.slice(0, 4);
}

export const JupiterSwapCard = () => {
  const { setVisible } = useWalletModal();
  const walletCtx = useWallet();
  const searchParams = useSearchParams();
  const containerId = "jupiter-integrated";
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";

  // Resolve initial pair: URL params > localStorage > defaults
  const initialPair = useMemo<Pair>(() => {
    const inParam = searchParams?.get("in");
    const outParam = searchParams?.get("out");
    if (inParam && outParam) return { input: inParam, output: outParam };
    return readStoredPair() ?? DEFAULT_PAIR;
  }, [searchParams]);

  const [pair, setPair] = useState<Pair>(initialPair);
  const [activeSide, setActiveSide] = useState<"input" | "output">("output");

  // Persist pair changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pair));
    } catch {
      /* ignore quota errors */
    }
  }, [pair]);

  const initJup = useCallback(() => {
    if (typeof window === "undefined" || !(window as any).Jupiter) return;
    const Jupiter = (window as any).Jupiter;
    try {
      if (typeof Jupiter.destroy === "function") {
        try { Jupiter.destroy(); } catch { /* ignore */ }
      }
      Jupiter.init({
        displayMode: "integrated",
        integratedTargetId: containerId,
        endpoint,
        enableWalletPassthrough: true,
        passthroughWalletContextState: walletCtx,
        onRequestConnectWallet: () => setVisible(true),
        formProps: {
          initialInputMint: pair.input,
          initialOutputMint: pair.output,
        },
        containerStyles: {
          background: "transparent",
          boxShadow: "none",
          borderRadius: "0px",
          height: "100%",
          padding: "0",
          margin: "0",
        },
        colorProps: {
          primaryColor: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#111",
          backgroundColor: "transparent",
          primaryTextColor: getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim() || "#111",
          warningColor: "#fbbf24",
          interactiveColor: "transparent",
          moduleColor: "transparent",
        },
      });

      // Inject light-mode contrast fixes once
      try {
        const styleId = "jupiter-swap-override";
        if (!document.getElementById(styleId)) {
          const st = document.createElement("style");
          st.id = styleId;
          st.textContent = `
            :root:not(.dark) #${containerId} *,
            :root:not(.dark) #${containerId} [class*="text"],
            :root:not(.dark) #${containerId} [class*="label"] { color: #0f1724 !important; }
            :root:not(.dark) #${containerId} .terminal-root,
            :root:not(.dark) #${containerId} [class*="container"],
            :root:not(.dark) #${containerId} [class*="module"],
            :root:not(.dark) #${containerId} [class*="swap"],
            :root:not(.dark) #${containerId} [class*="box"] {
              background: color-mix(in oklch, var(--color-card) 88%, #000 12%) !important;
            }
            #${containerId} button { border-radius: var(--radius-md) !important; font-weight:600 !important; }
            #${containerId} [class*="input"], #${containerId} input { background: color-mix(in oklch, var(--color-card) 80%, #000 20%) !important; color:#0f1724 !important }
            :root:not(.dark) #${containerId} [style*="rgba(255, 255, 255"] { backdrop-filter: saturate(1.05) blur(2px); opacity:0.98 }
            :root:not(.dark) #${containerId} .jup-primary, :root:not(.dark) #${containerId} .jup-action { color: #ffffff !important; background: var(--primary) !important }
          `;
          document.head.appendChild(st);
        }
      } catch { /* cosmetic */ }
    } catch {
      /* widget init failed — non-fatal */
    }
  }, [endpoint, pair.input, pair.output, setVisible, walletCtx]);

  useEffect(() => {
    const handleEscKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const modal = document.querySelector('[role="dialog"]');
        if (modal) {
          const closeBtn = modal.querySelector('button[aria-label*="close"], button[aria-label*="Close"]');
          if (closeBtn instanceof HTMLButtonElement) closeBtn.click();
        }
      }
    };

    if ((window as any)?.Jupiter) {
      initJup();
    } else {
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        if ((window as any)?.Jupiter) {
          clearInterval(poll);
          initJup();
        } else if (attempts > 100) {
          clearInterval(poll);
        }
      }, 50);
      document.addEventListener("keydown", handleEscKey);
      return () => {
        clearInterval(poll);
        document.removeEventListener("keydown", handleEscKey);
      };
    }

    document.addEventListener("keydown", handleEscKey);
    return () => document.removeEventListener("keydown", handleEscKey);
  }, [initJup]);

  // Click a token chip → assign to the active side (input/output)
  const onChipClick = (mint: string) => {
    setPair((prev) => {
      // Don't allow input == output
      if (activeSide === "input" && mint === prev.output) {
        return { input: mint, output: prev.input };
      }
      if (activeSide === "output" && mint === prev.input) {
        return { input: prev.output, output: mint };
      }
      return { ...prev, [activeSide]: mint };
    });
  };

  const flipSides = () => {
    setPair((prev) => ({ input: prev.output, output: prev.input }));
  };

  return (
    <Card className="atlas-card relative overflow-visible h-full flex flex-col border-border/50 bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60 transition-colors hover:border-foreground/20 hover:shadow-[0_6px_24px_-12px_rgba(0,0,0,0.25)] min-h-[360px]">
      <span className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-[radial-gradient(closest-side,var(--color-accent)/35%,transparent_70%)]" />
      <CardContent className="atlas-card-content pt-3 pb-3 px-3 flex-1 flex flex-col min-h-0 overflow-visible gap-2">
        {/* Curated token toolbar */}
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => setActiveSide("input")}
              className={`px-2 py-1 rounded-md font-medium transition-colors ${
                activeSide === "input"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={activeSide === "input"}
            >
              From: {symbolFor(pair.input)}
            </button>
            <button
              type="button"
              onClick={flipSides}
              className="p-1 rounded-md hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Flip tokens"
              title="Swap input/output"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setActiveSide("output")}
              className={`px-2 py-1 rounded-md font-medium transition-colors ${
                activeSide === "output"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={activeSide === "output"}
            >
              To: {symbolFor(pair.output)}
            </button>
          </div>
          <Badge variant="outline" className="text-[9px] tracking-wider opacity-70">
            {CURATED_TOKENS.length} tokens
          </Badge>
        </div>

        <div className="flex flex-wrap gap-1 px-1">
          {CURATED_TOKENS.map((t) => {
            const isActive =
              (activeSide === "input" && t.mint === pair.input) ||
              (activeSide === "output" && t.mint === pair.output);
            return (
              <button
                key={t.mint}
                type="button"
                onClick={() => onChipClick(t.mint)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card/60 text-muted-foreground border-border/60 hover:text-foreground hover:border-foreground/40"
                }`}
              >
                {t.symbol}
              </button>
            );
          })}
        </div>

        {/* Jupiter widget */}
        <div className="flex-1 min-h-0 w-full rounded-lg bg-transparent relative overflow-visible">
          <div id={containerId} className="bg-transparent !w-full !h-full overflow-visible" />
        </div>
      </CardContent>
    </Card>
  );
};

export default JupiterSwapCard;
