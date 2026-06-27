import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { BuildersInThisSpace } from "@/components/atlas/BuildersInThisSpace";
import {
  ATLAS_PROTOCOLS,
  getProtocol,
  getAllProtocolSlugs,
} from "@/lib/seo/atlas-protocols";
import { getSiteOrigin } from "@/lib/seo/site";
import { ArrowRight, ArrowUpRight, ShieldAlert } from "lucide-react";

type RouteParams = { protocol: string };

export async function generateStaticParams(): Promise<RouteParams[]> {
  return getAllProtocolSlugs().map((protocol) => ({ protocol }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { protocol } = await params;
  const p = getProtocol(protocol);
  if (!p) {
    return { title: "Protocol not found", robots: { index: false, follow: false } };
  }
  const title = `${p.name} on Solana — treasury use cases, risks, alternatives`;
  const description = p.tagline.length > 158 ? `${p.tagline.slice(0, 155)}...` : p.tagline;
  const path = `/atlas/protocols/${p.slug}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title: `${p.name} — dreyv atlas`, description, type: "article", url: path },
    twitter: { card: "summary_large_image", title: `${p.name} — dreyv atlas`, description },
  };
}

export default async function AtlasProtocolPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { protocol } = await params;
  const p = getProtocol(protocol);
  if (!p) notFound();

  const origin = getSiteOrigin();
  const path = `/atlas/protocols/${p.slug}`;
  const url = `${origin}${path}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: `${p.name} on Solana — treasury notes`,
        description: p.tagline,
        url,
        author: { "@id": `${origin}/#organization` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "dreyv atlas", item: `${origin}/atlas` },
          { "@type": "ListItem", position: 2, name: "Protocols", item: `${origin}/atlas/protocols` },
          { "@type": "ListItem", position: 3, name: p.name, item: url },
        ],
      },
    ],
  };

  const siblings = ATLAS_PROTOCOLS.filter((s) => s.slug !== p.slug).slice(0, 6);

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
          <span className="text-slate-700">protocols</span>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{p.slug}</span>
        </nav>

        <header className="mb-12">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-600 mb-4">
            {p.category.replace(/-/g, " ")}
          </p>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4 leading-tight">
            {p.name}
          </h1>
          <p className="text-base md:text-lg text-slate-600 leading-relaxed">{p.tagline}</p>
        </header>

        <article className="prose prose-slate prose-sm md:prose-base max-w-none prose-a:text-violet-600 prose-a:no-underline hover:prose-a:underline prose-strong:text-slate-900">
          <h2>Overview</h2>
          {p.overview.map((para, i) => <p key={i}>{para}</p>)}

          <h2>Treasury use cases</h2>
          <ul>{p.treasuryUse.map((u, i) => <li key={i}>{u}</li>)}</ul>

          <h2 className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" /> Risks
          </h2>
          <ul>{p.riskNotes.map((r, i) => <li key={i}>{r}</li>)}</ul>

          <h2>Alternatives</h2>
        </article>

        <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 not-prose">
          {p.competitors.map((c) => (
            <li key={c.name}>
              {c.slug ? (
                <Link
                  href={`/atlas/protocols/${c.slug}`}
                  className="group flex flex-col h-full rounded-3xl border border-violet-100 bg-white hover:border-violet-300 p-4 transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-slate-900">{c.name}</span>
                    <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-violet-600 transition" />
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{c.note}</p>
                </Link>
              ) : (
                <div className="flex flex-col h-full rounded-3xl border border-violet-100 bg-white p-4">
                  <span className="text-sm font-bold text-slate-900 mb-2">{c.name}</span>
                  <p className="text-xs text-slate-600 leading-relaxed">{c.note}</p>
                </div>
              )}
            </li>
          ))}
        </ul>

        <article className="prose prose-slate prose-sm md:prose-base max-w-none prose-a:text-violet-600 mt-12">
          <h2>dreyv workflows that touch {p.name}</h2>
        </article>

        <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 not-prose">
          {p.dreyvWorkflows.map((wf) => (
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

        <article className="prose prose-slate prose-sm md:prose-base max-w-none prose-a:text-violet-600 mt-12">
          <h2>References</h2>
          <ul>
            {p.references.map((r) => (
              <li key={r.href}>
                <a href={r.href} target="_blank" rel="noopener noreferrer">
                  {r.label} <ArrowUpRight className="inline h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
        </article>

        <div className="mt-12">
          <BuildersInThisSpace
            variant="light"
            query={`${p.name} ${p.category.replace(/-/g, " ")}`}
            subtitle={`Hackathon teams building on or alongside ${p.name} — indexed by Colosseum Copilot.`}
          />
        </div>

        {siblings.length > 0 && (
          <section className="mt-16 pt-12 border-t border-violet-100">
            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 mb-4">
              Other protocols in atlas
            </h2>
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {siblings.map((s) => (
                <li key={s.slug}>
                  <Link
                    href={`/atlas/protocols/${s.slug}`}
                    className="block text-sm text-slate-600 hover:text-violet-600 px-3 py-2 rounded-lg hover:bg-violet-50 transition"
                  >
                    {s.name}
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
