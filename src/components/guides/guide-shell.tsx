import Link from "next/link";
import Image from "next/image";
import { ReactNode } from "react";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { GUIDES, type GuideEntry } from "@/lib/seo/guides";
import guidesCrystal from "@/assets/guides-crystal.png";

// Custom hand-drawn arrow mark (no stock icons)
export function ArrowMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 12 L12 4" />
      <path d="M6 4 L12 4 L12 10" />
    </svg>
  );
}

interface GuideShellProps {
  topic: string;
  guide: Pick<GuideEntry, "title" | "description" | "publishedAt" | "readMinutes" | "slug">;
  children: ReactNode;
}

export function GuideShell({ topic, guide, children }: GuideShellProps) {
  const others = GUIDES.filter((g) => g.slug !== guide.slug).slice(0, 3);

  return (
    <div className="relative min-h-dvh w-full bg-marketing-bg-low text-slate-900 antialiased">
      {/* Solid violet ambient — single hue, no fuchsia/pink */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
        <div className="absolute -top-40 -left-40 h-[640px] w-[640px] rounded-full bg-violet-400/15 blur-[140px]" />
        <div className="absolute top-[20%] -right-24 h-[520px] w-[520px] rounded-full bg-violet-300/20 blur-[130px]" />
      </div>

      <SiteHeader />

      <main className="relative z-10 mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 pt-28 md:pt-32 pb-20">
        <Link
          href="/guides"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700 hover:text-violet-900 mb-8 transition-colors"
        >
          <span aria-hidden="true">←</span> All guides
        </Link>

        <header className="mb-12 md:mb-14">
          <div className="flex items-center gap-3 mb-5">
            <span className="inline-flex items-center rounded-full bg-violet-50 border border-violet-200 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-700">
              {topic}
            </span>
            <span className="text-[11px] text-slate-500">
              {guide.publishedAt} · ~{guide.readMinutes} min read
            </span>
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-slate-900 mb-6 leading-[1.1]">
            {guide.title}
          </h1>
          <p className="text-base md:text-lg text-slate-600 leading-relaxed">
            {guide.description}
          </p>
        </header>

        <article
          className="prose prose-slate prose-sm md:prose-base max-w-none
            prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-slate-900
            prose-h2:text-xl prose-h2:md:text-2xl prose-h2:mt-12 prose-h2:mb-4
            prose-p:text-slate-600 prose-p:leading-relaxed
            prose-li:text-slate-600 prose-li:marker:text-violet-500
            prose-strong:text-slate-900 prose-strong:font-semibold
            prose-a:text-violet-700 prose-a:no-underline prose-a:font-medium hover:prose-a:underline hover:prose-a:text-violet-900"
        >
          {children}
        </article>

        {/* CTA card — solid violet, no gradient */}
        <aside className="mt-16 rounded-2xl bg-violet-600 p-8 text-white shadow-[0_12px_40px_-12px_rgba(124,58,237,0.4)]">
          <div className="grid sm:grid-cols-[auto_1fr_auto] gap-6 items-center">
            <Image
              src={guidesCrystal}
              alt=""
              width={80}
              height={80}
              loading="lazy"
              className="hidden sm:block drop-shadow-[0_10px_20px_rgba(0,0,0,0.25)]"
            />
            <div>
              <h2 className="text-xl font-bold tracking-tight mb-2">
                Put this guide into practice
              </h2>
              <p className="text-violet-100 text-sm leading-relaxed">
                Open dreyv, describe what you want, simulate the impact, and approve from your multisig.
              </p>
            </div>
            <Link
              href="/auth?redirect=/app"
              className="inline-flex items-center gap-2 font-semibold text-sm px-5 py-2.5 rounded-xl bg-white text-violet-700 hover:bg-violet-50 transition-colors active:scale-[0.98] justify-self-start sm:justify-self-end"
            >
              Open dreyv
              <ArrowMark className="h-4 w-4" />
            </Link>
          </div>
        </aside>

        {others.length > 0 && (
          <section className="mt-16 pt-12 border-t border-violet-100">
            <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500 mb-5">
              More guides
            </h2>
            <ul className="grid gap-3">
              {others.map((g) => (
                <li key={g.slug}>
                  <Link
                    href={`/guides/${g.slug}`}
                    className="group flex items-start justify-between gap-4 rounded-2xl border border-violet-100 bg-white/80 backdrop-blur-sm hover:bg-white hover:border-violet-300 hover:shadow-[0_6px_24px_-12px_rgba(124,58,237,0.25)] p-5 transition-all"
                  >
                    <div>
                      <p className="text-sm font-bold text-slate-900 mb-1 group-hover:text-violet-700 transition-colors">
                        {g.title}
                      </p>
                      <p className="text-xs text-slate-500 leading-relaxed">{g.teaser}</p>
                    </div>
                    <ArrowMark className="h-4 w-4 text-slate-300 group-hover:text-violet-600 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-1" />
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
