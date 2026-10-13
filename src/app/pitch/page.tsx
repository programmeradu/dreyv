import type { Metadata } from "next";
import Image from "next/image";
import { SiteHeader, SiteFooter } from "@/components/marketing/legacy-chrome";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";
import { ArrowDownToLine, ArrowUpRight } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";

export const metadata: Metadata = {
  title: "Pitch Deck: dreyv",
  description:
    "The dreyv pitch deck: treasury operations for teams on Solana, simulated before anyone signs.",
  alternates: { canonical: "/pitch" },
  robots: { index: false, follow: false },
};

const TOTAL = 16;
const slides = Array.from({ length: TOTAL }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return { n, src: `/pitch/slide-${n}.jpg`, alt: `dreyv pitch deck: slide ${i + 1} of ${TOTAL}` };
});

export default function PitchPage() {
  return (
    <div className="min-h-screen bg-white font-manrope text-slate-900">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-violet-100">
        <span aria-hidden className="pointer-events-none absolute -top-32 -left-32 h-[28rem] w-[28rem] rounded-full bg-violet-300/30 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-40 -right-32 h-[32rem] w-[32rem] rounded-full bg-violet-400/20 blur-3xl" />

        <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-8 px-6 pt-20 pb-16 md:pt-28 md:pb-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
            <DreyvStar size={10} />
            Pitch Deck · 2026
          </div>

          <h1 className="max-w-4xl text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
            Treasury operations,
            <br />
            simulated before anyone signs.
          </h1>

          <p className="max-w-2xl text-lg leading-relaxed text-slate-600 md:text-xl">
            dreyv lets a treasury team say what it wants in plain English, see the simulated result,
            and sign it in their own multisig. dreyv never holds the keys.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <a
              href="/pitch/dreyv-pitch-deck.pdf"
              download
              className={marketingPrimaryCtaSm}
            >
              <ArrowDownToLine className="h-4 w-4" />
              Download PDF
            </a>
            <a
              href="/pitch/dreyv-pitch-deck.pptx"
              download
              className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition hover:border-violet-400 hover:text-violet-700"
            >
              <ArrowDownToLine className="h-4 w-4" />
              Download PowerPoint
            </a>
            <a
              href="/pitch/dreyv-pitch-deck.pdf"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-2 py-2.5 text-sm font-semibold text-violet-700 hover:text-violet-900"
            >
              Open full PDF
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* Slide grid */}
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <div className="mb-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-violet-700">
            <DreyvStar size={10} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              {TOTAL} slides
            </span>
          </div>
          <p className="text-sm text-slate-500">Best viewed full-screen.</p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {slides.map((s, idx) => (
            <figure
              key={s.n}
              className="group overflow-hidden rounded-3xl border border-violet-100 bg-white transition hover:border-violet-300"
            >
              <div className="relative aspect-[16/9] w-full overflow-hidden bg-violet-50">
                <Image
                  src={s.src}
                  alt={s.alt}
                  fill
                  sizes="(min-width: 768px) 50vw, 100vw"
                  className="object-cover"
                  priority={idx < 2}
                />
              </div>
              <figcaption className="flex items-center justify-between px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <span>Slide {s.n}</span>
                <span className="text-slate-400">{idx + 1} / {TOTAL}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-violet-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-16 md:flex-row md:items-center md:justify-between md:py-20">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Want to talk through the deck?
            </h2>
            <p className="mt-3 text-slate-600">
              We&rsquo;re raising incubation support to acquire our first 10 high-quality treasury users
              and build distribution. Reach out: founder-to-founder.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="/pitch/dreyv-pitch-deck.pdf" download className={marketingPrimaryCtaSm}>
              <ArrowDownToLine className="h-4 w-4" />
              Download PDF
            </a>
            <a
              href="mailto:samuel@dreyv.com?subject=dreyv%20pitch%20follow-up"
              className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition hover:border-violet-400 hover:text-violet-700"
            >
              Email the founder
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
