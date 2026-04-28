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
import { Urbanist } from "next/font/google";
import { useVault } from "@/lib/contexts/VaultContext";
import { WalletButton } from "@/components/WalletButton";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const wordmark = Urbanist({ subsets: ["latin"], weight: "600", display: "swap", adjustFontFallback: true });
import {
  AmbientGlow,
  SectionHeader,
  StreamIn,
  Surface,
  StreamingNumber,
} from "@/components/app-shell/primitives";
import {
  CompositionStrip,
  HeadlineValue,
  type Holding,
} from "@/components/app-shell/Composition";
import { CanvasStream } from "@/components/canvas/CanvasStream";
import { useCanvas } from "@/lib/canvas/CanvasContext";
import { AppEventBus } from "@/lib/events";

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

  const holdings: Holding[] = useMemo(() => {
    const tokens = (vaultTokens ?? []) as any[];
    if (tokens.length === 0) return [];
    return tokens
      .map((t) => {
        const sym = (t.symbol ?? "").toUpperCase() || "Asset";
        return {
          symbol: sym,
          label: SYMBOL_LABELS[sym] ?? sym,
          share: 0,
          value: typeof t.value === "number" ? t.value : 0,
        };
      })
      .filter((h) => h.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [vaultTokens]);

  const stableBalance = useMemo(() => {
    const tokens = (vaultTokens ?? []) as any[];
    return tokens
      .filter((t) => STABLES.has((t.symbol ?? "").toUpperCase()))
      .reduce((s, t) => s + (typeof t.value === "number" ? t.value : 0), 0);
  }, [vaultTokens]);

  return (
    <div className="relative h-full overflow-y-auto bg-white font-manrope text-slate-900">
      <AmbientGlow className="right-[-160px] top-[-200px]" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/app" className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-violet-700">
          <ArrowLeft className="h-3.5 w-3.5" />
          Home
        </Link>
        <Link href="/app" className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500/40" aria-label="dreyv home">
          <span className={cn(wordmark.className, "text-lg font-semibold tracking-tight text-violet-700 lowercase leading-none antialiased")}>dreyv</span>
        </Link>
        <WalletButton />
      </header>

      {/* HERO — compact */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-2">
        <StreamIn className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">Your treasury</p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">A clear picture, nothing more.</h1>
          <p className="max-w-xl text-sm text-slate-600">
            What you own, who can move it, and where it could be working a little harder. Ask Dreyv anything below — the canvas fills in.
          </p>
        </StreamIn>

        <StreamIn delay={0.1} className="mt-5 grid gap-4 md:grid-cols-[1.05fr_1fr]">
          <Surface glow className="p-5">
            <HeadlineValue
              label="Total value"
              value={vaultValue}
              hint={
                vaultChange24h !== null && vaultChange24h !== undefined
                  ? `${vaultChange24h >= 0 ? "+" : ""}${vaultChange24h.toFixed(2)}% in the last 24 hours`
                  : undefined
              }
            />
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-violet-100 pt-4">
              <SmallStat label="Assets" value={holdings.length} />
              <SmallStat label="24h change" value={vaultChange24h} suffix="%" decimals={2} signed />
              <SmallStat label="Largest position" text={holdings[0]?.label ?? "—"} />
            </div>
          </Surface>

          <CompositionStrip holdings={holdings} />
        </StreamIn>
      </section>

      {/* PULSE — empty/connect state if no vault */}
      {!activeVault && (
        <section className="relative z-10 mx-auto mt-6 max-w-6xl px-6">
          <Surface className="p-5 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">Get started</p>
            <h2 className="mt-1.5 text-lg font-semibold tracking-tight">Connect a treasury to begin</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
              Link a Phantom wallet, a Squads multisig, or paste any address to watch — Dreyv will populate everything below.
            </p>
            <div className="mt-3 flex justify-center gap-2">
              <button
                onClick={() => AppEventBus.emit("AGENT_COMMAND", { command: "Connect a wallet to my treasury", autoSubmit: false })}
                className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700"
              >
                Connect or paste address
              </button>
              <button
                onClick={() => AppEventBus.emit("AGENT_COMMAND", { command: "Show me an example treasury walkthrough", autoSubmit: false })}
                className="rounded-xl border border-violet-200 px-4 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50"
              >
                Show me how it works
              </button>
            </div>
          </Surface>
        </section>
      )}

      {/* CANVAS STREAM — generative bucket surface */}
      <section className="relative z-10 mx-auto mt-8 max-w-6xl px-6 pb-32">
        <SectionHeader
          eyebrow="Live canvas"
          title="Everything Dreyv is watching for you"
          description="Tokens, wallets, runway, payouts, policy. Each card is live — pin the ones you want to keep, dismiss the rest, and ask Dreyv to add more."
        />
        <div className="mt-4">
          <CanvasStream scope="treasury" />
        </div>
      </section>

      <TreasuryBlockSeeder
        activeVault={activeVault}
        vaultTokens={vaultTokens}
        vaultValue={vaultValue}
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
  stableBalance,
  vaultConfig,
  isMultisig,
  proposalsCount,
}: {
  activeVault: string | null;
  vaultTokens: any[];
  vaultValue: number | null;
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
      const rows = (vaultTokens ?? [])
        .map((t: any) => ({
          symbol: (t.symbol ?? "").toUpperCase() || "Asset",
          label: SYMBOL_LABELS[(t.symbol ?? "").toUpperCase()] ?? t.symbol,
          logo: t.logo ?? t.logoURI ?? t.icon ?? undefined,
          mint: t.mint ?? t.address ?? undefined,
          balance: typeof t.balance === "number" ? t.balance : typeof t.amount === "number" ? t.amount : undefined,
          value: typeof t.value === "number" ? t.value : undefined,
          change24h: typeof t.priceChange24h === "number" ? t.priceChange24h : undefined,
        }))
        .filter((r: any) => r.value && r.value > 0)
        .sort((a: any, b: any) => (b.value ?? 0) - (a.value ?? 0));
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

    // 3. RUNWAY
    {
      const id = `tr-runway-${activeVault ?? "empty"}`;
      // Without a real burn-rate watcher, we surface as insufficient — DACS
      // sub-agents will populate this with real months over time. Never invent.
      addBlock({
        id,
        type: "runway",
        source: "page",
        origin: "/app/treasury",
        title: "Runway",
        subtitle: "How many months you have at current burn",
        payload: {
          insufficient: true,
          stableBalance: stableBalance > 0 ? stableBalance : null,
        },
      });
      ids.push(id);
    }

    // 4. MASS SEND-OUTS
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

    // 6. YIELD ROUTING
    if (activeVault && stableBalance > 0) {
      const id = `tr-yield-${activeVault}`;
      addBlock({
        id,
        type: "empty-bucket",
        source: "page",
        origin: "/app/treasury",
        title: "Earn on idle stables",
        subtitle: "Curated, policy-bounded yield routing",
        payload: {
          description:
            "Dreyv can route your stables to vetted venues that match your risk band, with autopilot rails that respect your approvals.",
          prompt: "Find safe yield for my idle stables",
        },
      });
      ids.push(id);
    }

    // 7. REPORTING
    if (activeVault) {
      const id = `tr-report-${activeVault}`;
      addBlock({
        id,
        type: "empty-bucket",
        source: "page",
        origin: "/app/treasury",
        title: "Reports & shareable link",
        subtitle: "Live treasury report — public link, board-ready",
        payload: {
          description:
            "Generate a Karpatkey-style monthly report on demand, or share a live, read-only link with board members and accountants.",
          prompt: "Generate a treasury report I can share",
        },
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

function SmallStat({
  label,
  value,
  text,
  suffix = "",
  decimals = 0,
  signed = false,
}: {
  label: string;
  value?: number | null;
  text?: string;
  suffix?: string;
  decimals?: number;
  signed?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <div className="text-xl font-semibold tracking-tight text-slate-900">
        {text ? (
          text
        ) : value === null || value === undefined ? (
          <span className="text-slate-300">—</span>
        ) : (
          <StreamingNumber
            value={value}
            prefix={signed && value >= 0 ? "+" : ""}
            suffix={suffix}
            decimals={decimals}
          />
        )}
      </div>
    </div>
  );
}
