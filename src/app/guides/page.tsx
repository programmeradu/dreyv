import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { GUIDES } from "@/lib/seo/guides";
import { ArrowUpRight } from "lucide-react";

const TITLE = "Guides — dreyv";
const DESCRIPTION =
  "Practical guides for Solana treasury teams: intent-driven workflows, Squads multisig setup, DAO treasury playbooks, and DCA strategies.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/guides" },
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website" },
};

export default function GuidesIndexPage() {
  const sorted = [...GUIDES].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  );

  return (
    <div className="relative min-h-dvh w-full bg-[var(--dreyv-void)] text-white">
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="absolute top-[-10%] left-[-10%] h-[700px] w-[700px] rounded-full bg-dreyv-green/[0.06] blur-[150px]" />
        <div className="absolute top-[20%] right-[-5%] h-[600px] w-[600px] rounded-full bg-aurora-violet/[0.05] blur-[130px]" />
      </div>

      <SiteHeader />

      <main className="relative z-10 mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <header className="mb-12">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-4">
            dreyv // Guides
          </p>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-6 leading-tight">
            Practical guides for Solana treasury teams
          </h1>
          <p className="text-base md:text-lg text-white/55 leading-relaxed max-w-2xl">
            Multisig setup, treasury structure, DCA programs, and the case for
            intent-driven workflows. Written for operators, not maximalists.
          </p>
        </header>

        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sorted.map((guide) => (
            <li key={guide.slug}>
              <Link
                href={`/guides/${guide.slug}`}
                className="group flex flex-col h-full rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/20 p-6 transition-all"
              >
                <div className="flex items-start justify-between mb-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
                    {guide.publishedAt} · {guide.readMinutes} min
                  </p>
                  <ArrowUpRight className="h-4 w-4 text-white/30 group-hover:text-dreyv-green transition" />
                </div>
                <h2 className="text-lg font-black text-white mb-2 leading-tight">
                  {guide.title}
                </h2>
                <p className="text-sm text-white/50 leading-relaxed">{guide.teaser}</p>
              </Link>
            </li>
          ))}
        </ul>
      </main>

      <SiteFooter />
    </div>
  );
}
