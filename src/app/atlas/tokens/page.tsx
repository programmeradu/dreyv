import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { ATLAS_TOKENS } from "@/lib/seo/atlas-tokens";
import { ArrowUpRight } from "lucide-react";

const TITLE = "Solana token intelligence — dreyv atlas";
const DESCRIPTION =
  "Treasury-grade research notes on every token dreyv supports: SOL, USDC, USDT, JitoSOL, mSOL, JUP, BONK, WIF and more. Use cases, workflows, and risks.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/atlas/tokens" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
  },
};

const CATEGORY_LABEL: Record<string, string> = {
  native: "Native",
  lst: "Liquid staking",
  stablecoin: "Stablecoin",
  defi: "DeFi",
  memecoin: "Memecoin",
  infra: "Infra",
};

export default function AtlasTokensIndexPage() {
  const grouped = ATLAS_TOKENS.reduce<Record<string, typeof ATLAS_TOKENS>>(
    (acc, token) => {
      (acc[token.category] ||= []).push(token);
      return acc;
    },
    {},
  );

  return (
    <div className="relative min-h-dvh w-full bg-[var(--dreyv-void)] text-white">
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="absolute top-[-10%] left-[-10%] h-[700px] w-[700px] rounded-full bg-dreyv-green/[0.06] blur-[150px]" />
        <div className="absolute top-[20%] right-[-5%] h-[600px] w-[600px] rounded-full bg-aurora-violet/[0.05] blur-[130px]" />
      </div>

      <SiteHeader />

      <main className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <header className="mb-12">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-4">
            Atlas // Tokens
          </p>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-6 leading-tight">
            Solana token intelligence for treasuries
          </h1>
          <p className="text-base md:text-lg text-white/55 leading-relaxed max-w-2xl">
            Editorial research notes for every asset dreyv supports — what it does, how
            treasuries use it, the dreyv workflows that touch it, and the risks worth
            naming. Updated as the ecosystem moves.
          </p>
        </header>

        <div className="space-y-12">
          {Object.entries(grouped).map(([category, tokens]) => (
            <section key={category}>
              <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white/45 mb-4">
                {CATEGORY_LABEL[category] ?? category}
              </h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {tokens.map((token) => (
                  <li key={token.symbol}>
                    <Link
                      href={`/atlas/tokens/${token.symbol.toLowerCase()}`}
                      className="group flex flex-col h-full rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/20 p-5 transition-all"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-black text-lg tracking-tight">
                          {token.symbol}
                        </span>
                        <ArrowUpRight className="h-4 w-4 text-white/30 group-hover:text-white/70 transition" />
                      </div>
                      <p className="text-sm text-white/50 mb-3">{token.name}</p>
                      <p className="text-xs text-white/45 leading-relaxed line-clamp-3">
                        {token.tagline}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
