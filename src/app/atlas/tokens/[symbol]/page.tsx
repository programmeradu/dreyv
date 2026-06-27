import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { BuildersInThisSpace } from "@/components/atlas/BuildersInThisSpace";
import {
  ATLAS_TOKENS,
  getAtlasToken,
  getAllTokenSymbols,
} from "@/lib/seo/atlas-tokens";
import { getSiteOrigin } from "@/lib/seo/site";
import { ArrowRight, ArrowUpRight, ShieldAlert } from "lucide-react";

type RouteParams = { symbol: string };

export async function generateStaticParams(): Promise<RouteParams[]> {
  return getAllTokenSymbols().map((symbol) => ({ symbol }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { symbol } = await params;
  const token = getAtlasToken(symbol);
  if (!token) {
    return {
      title: "Token not found",
      robots: { index: false, follow: false },
    };
  }

  const title = `${token.symbol} (${token.name}) — Solana treasury notes`;
  const description = token.tagline.length > 158
    ? `${token.tagline.slice(0, 155)}...`
    : token.tagline;
  const path = `/atlas/tokens/${token.symbol.toLowerCase()}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: `${token.symbol} on Solana — dreyv atlas`,
      description,
      type: "article",
      url: path,
    },
    twitter: {
      card: "summary_large_image",
      title: `${token.symbol} — dreyv atlas`,
      description,
    },
  };
}

export default async function AtlasTokenPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { symbol } = await params;
  const token = getAtlasToken(symbol);
  if (!token) notFound();

  const origin = getSiteOrigin();
  const path = `/atlas/tokens/${token.symbol.toLowerCase()}`;
  const url = `${origin}${path}`;

  // FinancialProduct + BreadcrumbList JSON-LD
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "FinancialProduct",
        name: `${token.symbol} (${token.name})`,
        description: token.tagline,
        url,
        category: token.category,
        provider: { "@id": `${origin}/#organization` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "dreyv atlas", item: `${origin}/atlas` },
          { "@type": "ListItem", position: 2, name: "Tokens", item: `${origin}/atlas/tokens` },
          {
            "@type": "ListItem",
            position: 3,
            name: token.symbol,
            item: url,
          },
        ],
      },
    ],
  };

  // Sibling tokens for internal linking
  const siblings = ATLAS_TOKENS.filter((t) => t.symbol !== token.symbol).slice(0, 6);

  return (
    <div className="relative min-h-dvh w-full bg-[var(--dreyv-void)] text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="absolute top-[-10%] left-[-10%] h-[700px] w-[700px] rounded-full bg-dreyv-green/[0.06] blur-[150px]" />
        <div className="absolute top-[20%] right-[-5%] h-[600px] w-[600px] rounded-full bg-aurora-violet/[0.05] blur-[130px]" />
      </div>

      <SiteHeader />

      <main className="relative z-10 mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <nav aria-label="Breadcrumb" className="mb-8 text-[11px] text-white/40">
          <Link href="/atlas" className="hover:text-white/70">atlas</Link>
          <span className="mx-2">/</span>
          <Link href="/atlas/tokens" className="hover:text-white/70">tokens</Link>
          <span className="mx-2">/</span>
          <span className="text-white/70">{token.symbol.toLowerCase()}</span>
        </nav>

        <header className="mb-12">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-4">
            {token.category}
          </p>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4 leading-tight">
            {token.symbol}{" "}
            <span className="text-white/40 font-semibold">{token.name}</span>
          </h1>
          <p className="text-base md:text-lg text-white/60 leading-relaxed">
            {token.tagline}
          </p>
          {token.mint && (
            <p className="mt-4 text-[11px] text-white/35 font-mono break-all">
              mint: {token.mint}
            </p>
          )}
        </header>

        <article className="prose prose-invert prose-sm md:prose-base max-w-none prose-headings:font-bold prose-a:text-dreyv-green prose-a:no-underline hover:prose-a:underline prose-strong:text-white/95">
          <h2>Overview</h2>
          {token.overview.map((p, i) => (
            <p key={i}>{p}</p>
          ))}

          <h2>Treasury use cases</h2>
          <ul>
            {token.treasuryUseCases.map((useCase, i) => (
              <li key={i}>{useCase}</li>
            ))}
          </ul>

          <h2>dreyv workflows for {token.symbol}</h2>
          <p>
            These are the dreyv intents that touch {token.symbol} directly. Each one
            simulates the impact and routes through your multisig before signing.
          </p>
        </article>

        <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 not-prose">
          {token.dreyvWorkflows.map((wf) => (
            <li key={wf.label}>
              <Link
                href={wf.href}
                className="group flex flex-col h-full rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] hover:border-dreyv-green/30 p-4 transition-all"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-white">{wf.label}</span>
                  <ArrowRight className="h-4 w-4 text-white/30 group-hover:text-dreyv-green transition" />
                </div>
                <p className="text-xs text-white/50 leading-relaxed">{wf.description}</p>
              </Link>
            </li>
          ))}
        </ul>

        <article className="prose prose-invert prose-sm md:prose-base max-w-none prose-headings:font-bold prose-a:text-dreyv-green mt-12">
          <h2 className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-400/80" /> Risk notes
          </h2>
          <ul>
            {token.riskNotes.map((risk, i) => (
              <li key={i}>{risk}</li>
            ))}
          </ul>

          <h2>References</h2>
          <ul>
            {token.references.map((ref) => (
              <li key={ref.href}>
                <a href={ref.href} target="_blank" rel="noopener noreferrer">
                  {ref.label} <ArrowUpRight className="inline h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
        </article>

        <div className="mt-12">
          <BuildersInThisSpace
            variant="dark"
            query={`${token.symbol} ${token.category}`}
            subtitle={`Hackathon teams shipping on or around ${token.symbol} — indexed by Colosseum Copilot.`}
          />
        </div>

        <section className="mt-16 pt-12 border-t border-white/10">
          <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white/45 mb-4">
            Other tokens in atlas
          </h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {siblings.map((s) => (
              <li key={s.symbol}>
                <Link
                  href={`/atlas/tokens/${s.symbol.toLowerCase()}`}
                  className="block text-sm text-white/60 hover:text-white px-3 py-2 rounded-lg hover:bg-white/5 transition"
                >
                  {s.symbol}{" "}
                  <span className="text-white/30 text-xs">{s.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
