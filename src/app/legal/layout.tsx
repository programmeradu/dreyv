import Link from "next/link";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";

const legalLinks = [
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/refunds", label: "Refunds" },
  { href: "/legal/cookies", label: "Cookies" },
];

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dreyv-marketing-root relative min-h-dvh w-full scroll-smooth font-manrope bg-white text-slate-900">
      {/* Ambient violet light — solid hues only */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="absolute top-[-12%] left-[-10%] h-[620px] w-[620px] rounded-full bg-violet-400/[0.10] blur-[130px]" />
        <div className="absolute top-[20%] right-[-6%] h-[520px] w-[520px] rounded-full bg-violet-300/[0.08] blur-[120px]" />
        <div className="absolute inset-0 noise-overlay opacity-[0.025]" />
      </div>

      <SiteHeader />

      <main className="relative z-10 mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 pt-28 md:pt-32 pb-20">
        {/* Sub-nav */}
        <nav
          aria-label="Legal pages"
          className="mb-10 flex flex-wrap items-center gap-2 rounded-full border border-violet-200/70 bg-white/80 backdrop-blur px-2 py-1.5 shadow-[0_10px_40px_-25px_rgba(124,58,237,0.20)] w-fit"
        >
          {legalLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 hover:bg-violet-50 hover:text-violet-700 transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <article className="legal-prose">{children}</article>
      </main>

      <SiteFooter />
    </div>
  );
}
