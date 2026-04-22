import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";
import { Check, ArrowRight } from "lucide-react";
import tierBase from "@/assets/tier-base.png";
import tierMini from "@/assets/tier-mini.png";
import tierMax from "@/assets/tier-max.png";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "dreyv pricing — Free, Mini, and Max for non-custodial AI treasury workspaces. Billed via FastSpring; taxes shown at checkout.",
  alternates: { canonical: "/pricing" },
};

type Tier = {
  name: string;
  tagline: string;
  price: string;
  period: string;
  blurb: string;
  features: string[];
  cta: { label: string; href: string };
  featured?: boolean;
  image: typeof tierBase;
  imageAlt: string;
};

// Source of truth: src/lib/tier-config.ts
const tiers: Tier[] = [
  {
    name: "Free",
    tagline: "Solo operators",
    price: "$0",
    period: "/mo",
    blurb: "Everything a solo operator needs to compose, simulate, and sign.",
    features: [
      "1 multisig vault",
      "Up to 2 teammates",
      "3 mini-apps",
      "10 agent runs / day",
      "60 API calls / hour",
      "1 GB storage",
    ],
    cta: { label: "Get started", href: "/auth?redirect=/app" },
    image: tierBase,
    imageAlt: "Violet crystal shard representing the Free tier",
  },
  {
    name: "Mini",
    tagline: "Growing squads",
    price: "$49",
    period: "/mo",
    blurb: "More vaults, more seats, and the AI capacity busy treasuries need.",
    features: [
      "Up to 5 multisig vaults",
      "10 teammates per vault",
      "25 mini-apps",
      "100 agent runs / day",
      "Advanced analytics & SSE",
      "PDF export · 10 GB storage",
    ],
    cta: { label: "Upgrade — sign in", href: "/auth?redirect=/app/billing" },
    featured: true,
    image: tierMini,
    imageAlt: "Stack of violet crystal shards representing the Mini tier",
  },
  {
    name: "Max",
    tagline: "Enterprise nexus",
    price: "$199",
    period: "/mo",
    blurb: "Unlimited capacity, white-glove onboarding, and bespoke RPCs.",
    features: [
      "Unlimited vaults & teammates",
      "Unlimited mini-apps & agent runs",
      "5,000 API calls / hour",
      "Custom branding",
      "Priority support",
      "100 GB storage",
    ],
    cta: { label: "Upgrade — sign in", href: "/auth?redirect=/app/billing" },
    image: tierMax,
    imageAlt: "Violet obelisk monolith representing the Max tier",
  },
];

const guarantees = [
  {
    title: "Non-custodial by default",
    body: "Keys stay with your multisig. dreyv never holds funds or co-signs without you.",
  },
  {
    title: "Simulate before you sign",
    body: "Every intent runs on a fork first, with readable impact for every approver.",
  },
  {
    title: "Built for squads",
    body: "Roles, approvals, and audit trails designed for the way real treasuries operate.",
  },
];

export default function PricingPage() {
  return (
    <div className="dreyv-marketing-root relative min-h-dvh w-full scroll-smooth font-manrope bg-white text-slate-900">
      {/* Ambient light background — solid violet hues only, no fuchsia */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="absolute top-[-12%] left-[-10%] h-[620px] w-[620px] rounded-full bg-violet-400/[0.10] blur-[130px]" />
        <div className="absolute top-[20%] right-[-6%] h-[520px] w-[520px] rounded-full bg-violet-300/[0.08] blur-[120px]" />
        <div className="absolute inset-0 noise-overlay opacity-[0.025]" />
      </div>

      <SiteHeader />

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-28 md:pt-32 pb-12 md:pb-16">
          <div className="text-center max-w-2xl mx-auto">
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/70 backdrop-blur px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
              dreyv · Pricing
            </span>
            <h1 className="mt-5 text-4xl md:text-5xl font-semibold tracking-tight text-slate-900">
              Plans for every squad
            </h1>
            <p className="mt-4 text-base md:text-lg text-slate-600 leading-relaxed">
              Every tier ships the same core loop: compose treasury intent, simulate on a fork,
              show approvers readable impact, then execute under your multisig. Upgrade for more
              vaults, seats, and AI capacity.
            </p>
            <p className="mt-4 text-sm text-slate-500 leading-relaxed">
              Paid plans are billed securely through{" "}
              <span className="font-semibold text-slate-700">FastSpring</span> (merchant of
              record). Checkout shows your total including applicable taxes.{" "}
              <Link href="/legal/refunds" className="text-violet-700 font-medium hover:underline">
                Refund policy
              </Link>
              .
            </p>
          </div>
        </section>

        {/* Tiers */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-20">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {tiers.map((tier) => (
              <TierCard key={tier.name} tier={tier} />
            ))}
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            Prices in USD. Taxes calculated at checkout. Cancel anytime from your billing portal.
          </p>
        </section>

        {/* Guarantees — flat solid violet, no gradients */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-24">
          <div className="rounded-3xl border border-violet-200/60 bg-white/70 backdrop-blur-md p-8 md:p-10 shadow-[0_20px_60px_-30px_rgba(124,58,237,0.20)]">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {guarantees.map(({ title, body }) => (
                <div key={title} className="flex flex-col items-start">
                  <span className="h-1.5 w-10 rounded-full bg-violet-600" />
                  <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
                  <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Sales CTA — flat solid violet */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-24">
          <div className="rounded-3xl bg-violet-600 p-8 md:p-10 text-white flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-[0_30px_80px_-30px_rgba(124,58,237,0.45)]">
            <div className="max-w-xl">
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
                Need something custom?
              </h2>
              <p className="mt-2 text-violet-100 text-sm md:text-base leading-relaxed">
                Talk to us about dedicated infrastructure, bespoke integrations, or treasury
                advisory for funds, DAOs, and protocols.
              </p>
            </div>
            <Link
              href="mailto:hello@dreyv.app?subject=dreyv%20enterprise"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-50 transition-colors"
            >
              Contact sales
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function TierCard({ tier }: { tier: Tier }) {
  const isFeatured = tier.featured;

  return (
    <div
      className={
        isFeatured
          ? "relative rounded-3xl border-2 border-violet-600 bg-white p-7 flex flex-col shadow-[0_30px_70px_-25px_rgba(124,58,237,0.30)]"
          : "rounded-3xl border border-slate-200 bg-white/85 backdrop-blur p-7 flex flex-col shadow-[0_10px_40px_-20px_rgba(15,23,42,0.12)] hover:border-violet-300 hover:shadow-[0_18px_50px_-20px_rgba(124,58,237,0.20)] transition-all"
      }
    >
      {isFeatured && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
          Most popular
        </span>
      )}

      <div className="flex items-center gap-4 mb-5">
        <div className="h-16 w-16 shrink-0 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center overflow-hidden">
          <Image
            src={tier.image}
            alt={tier.imageAlt}
            width={56}
            height={56}
            loading="lazy"
            className="h-14 w-14 object-contain"
          />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{tier.name}</h2>
          <p className="text-xs text-slate-500">{tier.tagline}</p>
        </div>
      </div>

      <div className="flex items-baseline gap-1">
        <span className="text-4xl font-semibold tracking-tight text-slate-900">{tier.price}</span>
        <span className="text-sm font-medium text-slate-500">{tier.period}</span>
      </div>
      <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 font-medium">
        {tier.price === "$0" ? "No card required" : "Excludes tax · shown at checkout"}
      </p>

      <p className="mt-4 text-sm text-slate-600 leading-relaxed">{tier.blurb}</p>

      <ul className="mt-6 space-y-3 flex-1">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm text-slate-700">
            <span
              className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                isFeatured ? "bg-violet-600 text-white" : "bg-violet-100 text-violet-700"
              }`}
            >
              <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
            </span>
            {f}
          </li>
        ))}
      </ul>

      <Link
        href={tier.cta.href}
        className={
          isFeatured
            ? `${marketingPrimaryCtaSm} mt-8 w-full justify-center`
            : "mt-8 inline-flex w-full justify-center items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-800 hover:border-violet-400 hover:text-violet-700 transition-colors"
        }
      >
        {tier.cta.label}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
