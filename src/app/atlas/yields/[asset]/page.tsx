import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import {
  ATLAS_YIELD_ASSETS,
  getYieldAsset,
  getAllYieldSlugs,
} from "@/lib/seo/atlas-yields";
import { getSiteOrigin } from "@/lib/seo/site";
import { ArrowRight, ArrowUpRight, ShieldAlert } from "lucide-react";

type RouteParams = { asset: string };

export async function generateStaticParams(): Promise<RouteParams[]> {
  return getAllYieldSlugs().map((asset) => ({ asset }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { asset } = await params;
  const a = getYieldAsset(asset);
  if (!a) {
    return { title: "Yield asset not found", robots: { index: false, follow: false } };
  }
  const title = `Best ${a.symbol} yield on Solana — venues, mechanics, treasury fit`;
  const description = a.tagline.length > 158 ? `${a.tagline.slice(0, 155)}...` : a.tagline;
  const path = `/atlas/yields/${a.slug}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title: `${a.symbol} yield on Solana — dreyv atlas`, description, type: "article", url: path },
    twitter: { card: "summary_large_image", title: `${a.symbol} yield — dreyv atlas`, description },
  };
}

export default async function AtlasYieldPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { asset } = await params;
  const a = getYieldAsset(asset);
  if (!a) notFound();

  const origin = getSiteOrigin();
  const path = `/atlas/yields/${a.slug}`;
  const url = `${origin}${path}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: `Best ${a.symbol} yield on Solana`,
        description: a.tagline,
        url,
        author: { "@id": `${origin}/#organization` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "dreyv atlas", item: `${origin}/atlas` },
          { "@type": "ListItem", position: 2, name: "Yields", item: `${origin}/atlas/yields` },
          { "@type": "ListItem", position: 3, name: a.symbol, item: url },
        ],
      },
    ],
  };

  const siblings = ATLAS_YIELD_ASSETS.filter((s) => s.slug !== a.slug).slice(0, 6);

  return (
    <div className="relative min-h-dvh w-full bg-white text-slate-900">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="absolute top-[-10%] left-[-10%] h-[700px] w-[700px] rounded-full bg-violet-300/30 blur-[150px]" />
        <div className="absolute top-[20%] right-[-5%] h-[600px] w-[600px] rounded-full bg-violet-400/20 blur-[130px]" />
      </div>

      <SiteHeader />

      <main className="relative z-10 mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 md:py-24 font-[var(--font-manrope,Manrope)]">
        <nav aria-label="Breadcrumb" className="mb-8 text-[11px] text-slate-500">
          <Link href="/atlas" className="hover:text-violet-600">atlas</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-700">yields</span>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{a.slug}</span>
        </nav>

        <header className="mb-12">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-600 mb-4">
            {a.symbol} yield on Solana
          </p>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4 leading-tight">
            Best {a.symbol} yield on Solana
          </h1>
          <p className="text-base md:text-lg text-slate-600 leading-relaxed">{a.tagline}</p>
        </header>

        <article className="prose prose-slate prose-sm md:prose-base max-w-none prose-a:text-violet-600 prose-a:no-underline hover:prose-a:underline prose-strong:text-slate-900">
          <h2>Overview</h2>
          {a.overview.map((p, i) => <p key={i}>{p}</p>)}

          <h2>Where the yield comes from</h2>
          <ul>{a.yieldShape.map((y, i) => <li key={i}>{y}</li>)}</ul>

          <h2>Vetted venues</h2>
        </article>

        <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 not-prose">
          {a.venues.map((v) => (
            <li key={v.name}>
              <a
                href={v.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col h-full rounded-3xl border border-violet-100 bg-white hover:border-violet-300 p-4 transition-all"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold text-slate-900">{v.name}</span>
                  <ArrowUpRight className="h-4 w-4 text-slate-400 group-hover:text-violet-600 transition" />
                </div>
                <span className="text-[10px] uppercase tracking-wider text-violet-600 mb-2">{v.kind}</span>
                <p className="text-xs text-slate-600 leading-relaxed">{v.notes}</p>
              </a>
            </li>
          ))}
        </ul>

        <article className="prose prose-slate prose-sm md:prose-base max-w-none prose-a:text-violet-600 mt-12">
          <h2>Treasury fit</h2>
          <p><strong>Good fit when:</strong></p>
          <ul>{a.treasuryFit.good.map((g, i) => <li key={i}>{g}</li>)}</ul>
          <p><strong>Bad fit when:</strong></p>
          <ul>{a.treasuryFit.bad.map((b, i) => <li key={i}>{b}</li>)}</ul>

          <h2 className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" /> Risk notes
          </h2>
          <ul>{a.riskNotes.map((r, i) => <li key={i}>{r}</li>)}</ul>

          <h2>dreyv workflows for {a.symbol}</h2>
        </article>

        <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 not-prose">
          {a.dreyvWorkflows.map((wf) => (
            <li key={wf.label}>
              <Link
                href={wf.href}
                className="group flex flex-col h-full rounded-3xl border border-violet-100 bg-white hover:border-violet-300 p-4 transition-all"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-slate-900">{wf.label}</span>
                  <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-violet-600 transition" />
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{wf.description}</p>
              </Link>
            </li>
          ))}
        </ul>

        {siblings.length > 0 && (
          <section className="mt-16 pt-12 border-t border-violet-100">
            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 mb-4">
              Other yield assets in atlas
            </h2>
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {siblings.map((s) => (
                <li key={s.slug}>
                  <Link
                    href={`/atlas/yields/${s.slug}`}
                    className="block text-sm text-slate-600 hover:text-violet-600 px-3 py-2 rounded-lg hover:bg-violet-50 transition"
                  >
                    {s.symbol} <span className="text-slate-400 text-xs">{s.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
