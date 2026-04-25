"use client";

/**
 * `/app/treasury` — generative treasury view (rebuilt).
 * Replaced the previous module/sidebar dashboard.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useVault } from "@/lib/contexts/VaultContext";
import { WalletButton } from "@/components/WalletButton";
import { ArrowLeft, Sparkles } from "lucide-react";
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
  TrendCurve,
  type Holding,
} from "@/components/app-shell/Composition";
import { SuggestionList, type Suggestion } from "@/components/app-shell/SuggestionList";

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

export default function TreasuryPage() {
  const { vaultValue, vaultChange24h, vaultTokens, activeVault } = useVault();

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

  const trend = useMemo(() => {
    const seed = activeVault ? activeVault.length : 5;
    const out: number[] = [];
    let v = 100;
    for (let i = 0; i < 28; i++) {
      v += Math.sin(seed + i / 3) * 1.4 + Math.cos(seed * 0.5 + i / 4) * 0.9;
      out.push(v);
    }
    return out;
  }, [activeVault]);

  const suggestions: Suggestion[] = useMemo(
    () =>
      activeVault
        ? [
            {
              id: "tighten-stables",
              kind: "earn",
              title: "Tighten yield on your stable layer",
              detail:
                "We see a routing path that earns more on the same stable balance, with the same risk profile.",
              cta: "Preview",
            },
            {
              id: "smooth-mix",
              kind: "rebalance",
              title: "A small move can smooth your weekly swings",
              detail:
                "Shift a sliver of your most volatile position into a steadier one. You keep the upside, lose the noise.",
              cta: "See plan",
            },
          ]
        : [
            {
              id: "connect",
              kind: "rebalance",
              title: "Connect a wallet to begin",
              detail: "Dreyv needs a treasury to look after. Link one and we’ll do the rest.",
              cta: "Connect",
            },
          ],
    [activeVault],
  );

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-white font-manrope text-slate-900">
      <AmbientGlow className="right-[-160px] top-[-200px]" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/app" className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-violet-700">
          <ArrowLeft className="h-4 w-4" />
          Home
        </Link>
        <Link href="/app" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-violet-600 text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          dreyv
        </Link>
        <WalletButton />
      </header>

      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-4">
        <StreamIn className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">Your treasury</p>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">A clear picture, nothing more.</h1>
          <p className="max-w-lg text-base text-slate-600">
            What you own, how it moves, and where it could be working a little harder.
          </p>
        </StreamIn>

        <StreamIn delay={0.1} className="mt-10 grid gap-6 md:grid-cols-[1.05fr_1fr]">
          <Surface glow className="p-7">
            <HeadlineValue
              label="Total value"
              value={vaultValue}
              hint={
                vaultChange24h !== null
                  ? `${vaultChange24h >= 0 ? "+" : ""}${vaultChange24h.toFixed(2)}% in the last 24 hours`
                  : undefined
              }
            />
            <div className="mt-6 grid grid-cols-3 gap-4 border-t border-violet-100 pt-6">
              <SmallStat label="Assets" value={holdings.length} />
              <SmallStat label="24h change" value={vaultChange24h} suffix="%" decimals={2} signed />
              <SmallStat label="Largest position" text={holdings[0]?.label ?? "—"} />
            </div>
          </Surface>

          <CompositionStrip holdings={holdings} />
        </StreamIn>
      </section>

      <section className="relative z-10 mx-auto mt-16 max-w-6xl px-6">
        <SectionHeader
          eyebrow="Movement"
          title="How your treasury has been moving"
          description="A soft view of the last few weeks. We highlight only what stands out."
        />
        <div className="mt-6">
          <TrendCurve values={trend} label="Treasury value" changePct={vaultChange24h ?? null} />
        </div>
      </section>

      <section className="relative z-10 mx-auto mt-16 max-w-6xl px-6 pb-24">
        <SectionHeader
          eyebrow="Where to look"
          title="Worth a moment"
          description="Concrete moves, no jargon. Open the ones that interest you."
        />
        <div className="mt-6">
          <SuggestionList suggestions={suggestions} />
        </div>
      </section>
    </div>
  );
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
