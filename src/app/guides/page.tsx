import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { GUIDES } from "@/lib/seo/guides";
import { ArrowUpRight, BookOpen, Sparkles } from "lucide-react";
import { marketingPrimaryCta } from "@/components/home/marketing-styles";

const TITLE = "Guides — dreyv";
const DESCRIPTION =
  "Practical guides for Solana treasury teams: intent-driven workflows, Squads multisig setup, DAO treasury playbooks, and DCA strategies.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/guides" },
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website" },
};

const TOPIC_TAG: Record<string, string> = {
  "intent-driven-treasury-solana": "Workflow",
  "solana-dao-treasury-management": "Playbook",
  "squads-multisig-setup-guide": "Multisig",
  "dca-on-solana-guide": "DCA",
};

export default function GuidesIndexPage() {
  const sorted = [...GUIDES].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  );
  const [featured, ...rest] = sorted;

  return (
    <div className="relative min-h-dvh w-full bg-marketing-bg-low text-slate-900 antialiased">
      {/* Soft ambient violet wash to match home aesthetic */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
        <div className="absolute -top-40 -left-40 h-[640px] w-[640px] rounded-full bg-violet-300/20 blur-[140px]" />
        <div className="absolute top-[10%] -right-24 h-[520px] w-[520px] rounded-full bg-fuchsia-200/25 blur-[130px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(139,92,246,0.08),transparent_60%)]" />
      </div>

      <SiteHeader />

      <main className="relative z-10 pt-28 md:pt-32 pb-20">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-200/70 bg-white/70 backdrop-blur-sm px-3 py-1 mb-6 shadow-sm">
              <Sparkles className="h-3 w-3 text-violet-600" />
              <span className="text-[11px] font-semibold text-violet-700 uppercase tracking-wider">
                dreyv guides
              </span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-slate-900 leading-[1.05] mb-6">
              Practical guides for{" "}
              <span className="bg-gradient-to-r from-violet-600 via-violet-500 to-fuchsia-500 bg-clip-text text-transparent">
                Solana treasury teams
              </span>
            </h1>
            <p className="text-base md:text-lg text-slate-600 leading-relaxed max-w-2xl">
              Multisig setup, treasury structure, DCA programs, and the case for
              intent-driven workflows. Written for operators, not maximalists.
            </p>
          </div>
        </section>

        {/* Featured guide */}
        {featured && (
          <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 mt-12 md:mt-16">
            <Link
              href={`/guides/${featured.slug}`}
              className="group relative block overflow-hidden rounded-3xl border border-violet-200/60 bg-gradient-to-br from-white via-violet-50/40 to-fuchsia-50/30 p-8 md:p-12 shadow-[0_8px_40px_-12px_rgba(91,33,182,0.18)] hover:shadow-[0_12px_50px_-12px_rgba(91,33,182,0.28)] transition-all"
            >
              <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-violet-300/30 blur-3xl pointer-events-none" />
              <div className="relative grid md:grid-cols-[1fr_auto] gap-6 items-end">
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600/10 border border-violet-300/40 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-700">
                      <BookOpen className="h-3 w-3" /> Featured
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {featured.publishedAt} · {featured.readMinutes} min read
                    </span>
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 leading-tight mb-3">
                    {featured.title}
                  </h2>
                  <p className="text-base text-slate-600 leading-relaxed max-w-2xl">
                    {featured.teaser}
                  </p>
                </div>
                <div className="flex md:justify-end">
                  <span className={marketingPrimaryCta}>
                    Read guide
                    <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </span>
                </div>
              </div>
            </Link>
          </section>
        )}

        {/* Other guides grid */}
        {rest.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 mt-12 md:mt-16">
            <div className="flex items-end justify-between mb-6">
              <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                More guides
              </h2>
              <span className="text-xs text-slate-400">
                {rest.length} {rest.length === 1 ? "article" : "articles"}
              </span>
            </div>
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {rest.map((guide) => (
                <li key={guide.slug}>
                  <Link
                    href={`/guides/${guide.slug}`}
                    className="group flex flex-col h-full rounded-2xl border border-violet-100/80 bg-white/80 backdrop-blur-sm hover:bg-white hover:border-violet-300/70 hover:shadow-[0_8px_30px_-12px_rgba(91,33,182,0.22)] p-6 transition-all"
                  >
                    <div className="flex items-start justify-between mb-5">
                      <span className="inline-flex items-center rounded-full bg-violet-50 border border-violet-200/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-700">
                        {TOPIC_TAG[guide.slug] ?? "Guide"}
                      </span>
                      <ArrowUpRight className="h-4 w-4 text-slate-300 group-hover:text-violet-600 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 mb-2 leading-snug group-hover:text-violet-700 transition-colors">
                      {guide.title}
                    </h3>
                    <p className="text-sm text-slate-600 leading-relaxed mb-5 flex-1">
                      {guide.teaser}
                    </p>
                    <div className="flex items-center justify-between pt-4 border-t border-slate-100 text-[11px] text-slate-500">
                      <span>{guide.publishedAt}</span>
                      <span>{guide.readMinutes} min read</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* CTA strip */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 mt-20">
          <div className="rounded-3xl border border-violet-200/60 bg-gradient-to-r from-violet-600 to-fuchsia-600 p-8 md:p-12 text-white shadow-[0_12px_40px_-12px_rgba(91,33,182,0.45)]">
            <div className="grid md:grid-cols-[1fr_auto] gap-6 items-center">
              <div>
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
                  Ready to put a guide into practice?
                </h2>
                <p className="text-violet-100 leading-relaxed max-w-xl">
                  Open dreyv, describe what you want in plain English, simulate the
                  impact, and approve from your multisig. Free to start.
                </p>
              </div>
              <Link
                href="/auth?redirect=/app"
                className="group inline-flex items-center gap-2 font-semibold text-sm px-6 py-3 rounded-xl bg-white text-violet-700 hover:bg-violet-50 transition-colors active:scale-[0.98] justify-self-start md:justify-self-end"
              >
                Open dreyv
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
