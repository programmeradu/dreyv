"use client";

/**
 * `/app/treasury` — generative, agent-extensible treasury surface.
 *
 * Architecture (matches research synthesis in mem://research/treasury-landscape):
 *  - Hero rail        : live valuation + composition (no mocks).
 *  - Pulse rail       : autonomous watcher narratives surfaced via Canvas.
 *  - Action rail      : the global CommandBar (mounted in /app/layout.tsx).
 *  - Stream rail      : CanvasStream — every block (tokens, wallets, runway,
 *                        mass-send, policy, yield, reporting…) is a CanvasBlock
 *                        emitted by this page on mount and by agents at runtime.
 *
 * No fixed sections per bucket. Empty buckets render as `empty-bucket` blocks
 * with a single "Ask Dreyv to set this up" affordance that opens the
 * CommandBar pre-filled. NEVER render mock/demo figures.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { useDeclareFocus } from "@/lib/commandbar/focus-context";
import { Urbanist } from "next/font/google";
import { useVault } from "@/lib/contexts/VaultContext";
import { WalletButton } from "@/components/WalletButton";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const wordmark = Urbanist({ subsets: ["latin"], weight: "600", display: "swap", adjustFontFallback: true });
import { SectionHeader, StreamIn } from "@/components/app-shell/primitives";
import { CanvasStream } from "@/components/canvas/CanvasStream";
import { useCanvas } from "@/lib/canvas/CanvasContext";
import { AppEventBus } from "@/lib/events";
import { TreasuryCommandDock } from "@/components/treasury/TreasuryCommandDock";
import { WatcherCanvasBridge } from "@/components/treasury/WatcherCanvasBridge";
import { EvmWatchersPanel } from "@/components/treasury/EvmWatchersPanel";
import { SovereignHero, type HeroHolding } from "@/components/treasury/SovereignHero";
import { DreyvStar } from "@/components/studio/DreyvStar";

const SYMBOL_LABELS: Record<string, string> = {
  SOL: "Solana",
  USDC: "USD Coin",
  USDT: "Tether",
  JITOSOL: "JitoSOL",
  MSOL: "Marinade SOL",
  BSOL: "BlazeSOL",
  BONK: "Bonk",
  JUP: "Jupiter",
};

const STABLES = new Set(["USDC", "USDT", "PYUSD", "USDH", "DAI"]);

export default function TreasuryPage() {
  const {
    vaultValue,
    vaultChange24h,
    vaultTokens,
    activeVault,
    vaultConfig,
    isMultisig,
    proposals,
  } = useVault();

  useDeclareFocus({
    scope: "treasury.overview",
    label: "Treasury",
    data: { vault: activeVault, isMultisig, valueUsd: vaultValue, change24h: vaultChange24h, tokenCount: (vaultTokens ?? []).length, proposalsOpen: (proposals ?? []).length },
  }, [activeVault, vaultValue, vaultChange24h, (vaultTokens ?? []).length, (proposals ?? []).length, isMultisig]);

  const holdings: HeroHolding[] = useMemo(() => {
    const tokens = (vaultTokens ?? []) as any[];
    if (tokens.length === 0) return [];
    return tokens
      .map((t) => {
        const sym = (t.symbol ?? "").toUpperCase() || "Asset";
        return {
          symbol: sym,
          label: SYMBOL_LABELS[sym] ?? sym,
          value: typeof t.value === "number" ? t.value : 0,
          logo: t.logo ?? t.logoURI ?? t.icon ?? undefined,
          mint: t.mint ?? t.address ?? undefined,
        };
      })
      .filter((h) => h.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [vaultTokens]);

  const stableBalance = useMemo(() => {
    const tokens = (vaultTokens ?? []) as any[];
    return tokens
      .filter((t) => STABLES.has((t.symbol ?? "").toUpperCase()))
      .reduce((s, t) => s + (typeof t.value === "number" ? t.value : 0), 0);
  }, [vaultTokens]);

  const basket = useMemo(() => {
    const total = holdings.reduce((s, h) => s + h.value, 0);
    if (total <= 0) return [{ symbol: "SOL", weight: 1 }];
    return holdings.slice(0, 5).map((h) => ({ symbol: h.symbol, weight: h.value / total }));
  }, [holdings]);

  return (
    <div className="relative h-full overflow-y-auto bg-white font-manrope text-slate-900">
      <header className="relative z-10 mx-auto hidden max-w-6xl items-center justify-between gap-3 px-4 py-3 md:flex md:px-6 md:py-4">
        <Link href="/app" className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-violet-700">
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Home</span>
        </Link>
        <Link href="/app" className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500/40" aria-label="dreyv home">
          <span className={cn(wordmark.className, "text-lg font-semibold tracking-tight text-violet-700 lowercase leading-none antialiased")}>dreyv</span>
        </Link>
        <WalletButton />
      </header>

      {/* HERO — sovereign cockpit */}
      <section className="relative z-10 mx-auto max-w-6xl px-4 pt-4 sm:px-6 sm:pt-2">
        <StreamIn>
          <SovereignHero
            totalValue={vaultValue}
            change24h={vaultChange24h}
            holdings={holdings}
            assetCount={holdings.length}
            stableBalance={stableBalance}
            signers={vaultConfig}
            isMultisig={isMultisig}
            pendingApprovals={proposals?.length ?? 0}
            basket={basket}
          />
        </StreamIn>
      </section>

      {/* Connect-state — only when there's no vault */}
      {!activeVault && (
        <section className="relative z-10 mx-auto mt-5 max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50/50 px-5 py-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <DreyvStar size={14} className="text-violet-600" />
              <div>
                <p className="text-sm font-semibold text-slate-900">Connect a treasury to begin</p>
                <p className="text-xs text-slate-600">Phantom, Squads multisig, or any address — read-only is fine.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => AppEventBus.emit("AGENT_COMMAND", { command: "Connect a wallet to my treasury", autoSubmit: false })}
                className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700"
              >
                Connect or paste address
              </button>
              <button
                onClick={() => AppEventBus.emit("AGENT_COMMAND", { command: "Show me an example treasury walkthrough", autoSubmit: false })}
                className="rounded-xl border border-violet-200 bg-white px-4 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50"
              >
                Show me how
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ACTION DOCK — contextual treasury prompts (treasury/payments/policy/risk/yield) */}
      <section className="relative z-10 mx-auto mt-6 max-w-6xl px-4 sm:px-6">
        <TreasuryCommandDock />
      </section>

      {/* CROSS-CHAIN WATCHERS — moved out of the deleted /app/opportunities */}
      <section className="relative z-10 mx-auto mt-6 max-w-6xl px-4 sm:px-6">
        <EvmWatchersPanel />
      </section>

      {/* CANVAS STREAM — generative bucket surface */}
      <section className="relative z-10 mx-auto mt-8 max-w-6xl px-4 pb-40 sm:px-6 sm:pb-32">
        <SectionHeader
          eyebrow="Live canvas"
          title="Everything Dreyv is watching for you"
          description="Tokens, wallets, runway, payouts, policy. Each card is live — pin the ones you want to keep, dismiss the rest, and ask Dreyv to add more."
        />
        <div className="mt-4">
          <CanvasStream scope="treasury" />
        </div>
      </section>

      <WatcherCanvasBridge />

      <TreasuryBlockSeeder
        activeVault={activeVault}
        vaultTokens={vaultTokens}
        vaultValue={vaultValue}
        vaultChange24h={vaultChange24h}
        stableBalance={stableBalance}
        vaultConfig={vaultConfig}
        isMultisig={isMultisig}
        proposalsCount={proposals?.length ?? 0}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Block seeder — emits the foundation buckets into the shared Canvas         */
/* -------------------------------------------------------------------------- */

function TreasuryBlockSeeder({
  activeVault,
  vaultTokens,
  vaultValue,
  vaultChange24h,
  stableBalance,
  vaultConfig,
  isMultisig,
  proposalsCount,
}: {
  activeVault: string | null;
  vaultTokens: any[];
  vaultValue: number | null;
  vaultChange24h: number | null;
  stableBalance: number;
  vaultConfig: { threshold: number; members: number } | null;
  isMultisig: boolean;
  proposalsCount: number;
}) {
  const { addBlock, removeBlock, blocks } = useCanvas();
  const seededIds = useRef<string[]>([]);

  // Reseed on key state changes. Prefix our ids so we only ever clear our own.
  useEffect(() => {
    // Clear previously seeded blocks
    for (const id of seededIds.current) removeBlock(id);
    seededIds.current = [];

    const ids: string[] = [];

    // 1. TOKENS
    {
      const id = `tr-tokens-${activeVault ?? "empty"}`;
      const total = (vaultTokens ?? []).reduce(
        (s: number, t: any) => s + (typeof t.value === "number" ? t.value : 0),
        0,
      );
      const mapped = (vaultTokens ?? [])
        .map((t: any) => ({
          symbol: (t.symbol ?? "").toUpperCase() || "Asset",
          label: SYMBOL_LABELS[(t.symbol ?? "").toUpperCase()] ?? t.symbol,
          logo: t.logo ?? t.logoURI ?? t.icon ?? undefined,
          mint: t.mint ?? t.address ?? undefined,
          balance: typeof t.balance === "number" ? t.balance : typeof t.amount === "number" ? t.amount : undefined,
          value: typeof t.value === "number" ? t.value : undefined,
          change24h: typeof t.priceChange24h === "number" ? t.priceChange24h : undefined,
        }))
        .filter((r: any) => (r.balance && r.balance > 0) || (r.value && r.value > 0) || r.symbol === "SOL");
      if (!mapped.some((r: any) => r.symbol === "SOL")) {
        mapped.push({ symbol: "SOL", label: "Solana", logo: undefined, mint: "So11111111111111111111111111111111111111112", balance: 0, value: 0, change24h: undefined });
      }
      const rows = mapped.sort((a: any, b: any) => {
        if (a.symbol === "SOL") return -1;
        if (b.symbol === "SOL") return 1;
        return (b.value ?? 0) - (a.value ?? 0);
      });
      addBlock({
        id,
        type: "tokens-table",
        source: "page",
        origin: "/app/treasury",
        title: "Tokens in your treasury",
        subtitle: rows.length ? `${rows.length} assets · live prices` : "Connect a wallet to see your token balances",
        payload: { rows, totalValue: total > 0 ? total : null },
        pinned: true,
      });
      ids.push(id);
    }

    // 2. WALLETS
    {
      const id = `tr-wallets-${activeVault ?? "empty"}`;
      const wallets = activeVault
        ? [
            {
              address: activeVault,
              label: isMultisig ? "Treasury (Squads multisig)" : "Treasury wallet",
              kind: isMultisig ? ("multisig" as const) : ("hot" as const),
              threshold: vaultConfig?.threshold,
              members: vaultConfig?.members,
              value: vaultValue ?? undefined,
              pendingApprovals: proposalsCount,
            },
          ]
        : [];
      addBlock({
        id,
        type: "wallets-roster",
        source: "page",
        origin: "/app/treasury",
        title: "Wallets & signers",
        subtitle: activeVault
          ? "Add more wallets, signers, or watch-only addresses"
          : "No wallets connected yet",
        payload: { wallets },
      });
      ids.push(id);
    }

    // 3. RUNWAY — RunwayBlock fetches real burn from /api/treasury/events
    {
      const id = `tr-runway-${activeVault ?? "empty"}`;
      addBlock({
        id,
        type: "runway",
        source: "page",
        origin: "/app/treasury",
        title: "Runway",
        subtitle: "How many months you have at current burn",
        payload: {
          wallet: activeVault,
          stableBalance: stableBalance > 0 ? stableBalance : null,
        },
      });
      ids.push(id);
    }

    if (activeVault) {
      const id = `tr-masssend-${activeVault}`;
      addBlock({
        id,
        type: "mass-send",
        source: "page",
        origin: "/app/treasury",
        title: "Mass send-outs",
        subtitle: "Payroll, airdrops, grants — one batch, one approval",
        payload: {
          wallet: activeVault,
          isMultisig,
          defaultToken: stableBalance > 0 ? "USDC" : "SOL",
        },
      });
      ids.push(id);
    }

    // 5. POLICY & APPROVALS
    if (activeVault) {
      const id = `tr-policy-${activeVault}`;
      addBlock({
        id,
        type: "policy-approvals",
        source: "page",
        origin: "/app/treasury",
        title: "Policy & approvals",
        subtitle: "Spending limits, allowlists, signer roster",
        payload: {
          wallet: activeVault,
          isMultisig,
        },
      });
      ids.push(id);
    }

    // 5b. RECURRING PAYOUTS — Phase 6
    if (activeVault) {
      const id = `tr-recurring-${activeVault}`;
      addBlock({
        id,
        type: "recurring-payouts",
        source: "page",
        origin: "/app/treasury",
        title: "Recurring payouts",
        subtitle: "Payroll, grants, contributors — on a schedule",
        payload: { wallet: activeVault },
      });
      ids.push(id);
    }

    // 5c. GAS-TANK WATCHER — Phase 6
    if (activeVault) {
      const id = `tr-gastank-${activeVault}`;
      addBlock({
        id,
        type: "gas-tank",
        source: "page",
        origin: "/app/treasury",
        title: "Gas tank",
        subtitle: "Auto-refill SOL when this vault dips below your floor",
        payload: { wallet: activeVault },
      });
      ids.push(id);
    }

    // 5d. INVOICE INBOX — Phase 6
    if (activeVault) {
      const id = `tr-invoices-${activeVault}`;
      addBlock({
        id,
        type: "invoice-inbox",
        source: "page",
        origin: "/app/treasury",
        title: "Invoice inbox",
        subtitle: "Bills you've received — batch them by due date",
        payload: { wallet: activeVault },
      });
      ids.push(id);
    }

    // 6. YIELD ROUTING (Phase 7)
    if (activeVault) {
      const id = `tr-yield-${activeVault}`;
      addBlock({
        id,
        type: "yield-routing",
        source: "page",
        origin: "/app/treasury",
        title: "Earn on idle stables",
        subtitle: "Policy-bounded yield routing · HITL deploys",
        payload: { wallet: activeVault, stableBalance },
      });
      ids.push(id);
    }

    // 7. REPORTING & SHAREABLE LINK (Phase 7)
    if (activeVault) {
      const id = `tr-report-${activeVault}`;
      addBlock({
        id,
        type: "reports-share",
        source: "page",
        origin: "/app/treasury",
        title: "Reports & shareable link",
        subtitle: "Board-ready snapshot · public read-only link",
        payload: {
          wallet: activeVault,
          valuation: vaultValue,
          change24h: vaultChange24h,
          tokens: vaultTokens ?? [],
        },
      });
      ids.push(id);
    }

    // 8. WALLET & ASSET SECURITY (Phase 7)
    if (activeVault) {
      const id = `tr-security-${activeVault}`;
      addBlock({
        id,
        type: "wallet-security",
        source: "page",
        origin: "/app/treasury",
        title: "Wallet & asset security",
        subtitle: "Signer hygiene · key risk audit",
        payload: { wallet: activeVault },
      });
      ids.push(id);
    }

    seededIds.current = ids;

    // We intentionally do NOT clean up on unmount — pinned blocks persist
    // and ephemeral blocks should outlive route changes within /app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVault, vaultTokens, vaultValue, stableBalance, vaultConfig?.threshold, vaultConfig?.members, isMultisig, proposalsCount]);

  // Touch `blocks` so the seeder re-runs cleanly when the canvas resets (e.g. signin).
  void blocks.length;

  return null;
}

