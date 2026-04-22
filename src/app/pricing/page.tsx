import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";
import {
  Check,
  Sparkles,
  Rocket,
  Building2,
  ArrowRight,
  ShieldCheck,
  Zap,
  Users,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "dreyv pricing — Base, Mini, and Max for non-custodial AI treasury workspaces. Billed via FastSpring; taxes shown at checkout.",
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
  Icon: React.ComponentType<{ className?: string }>;
  accent: string; // tailwind color hue, e.g. "violet"
};

const tiers: Tier[] = [
  {
    name: "Base",
    tagline: "Free forever",
    price: "$0",
    period: "/mo",
    blurb: "Everything a solo operator needs to compose, simulate, and sign.",
    features: [
      "1 multisig vault",
      "Up to 3 teammates",
      "Command bar prompts",
      "Standard security routing",
      "Community support",
    ],
    cta: { label: "Get started", href: "/auth?redirect=/app" },
    Icon: Sparkles,
    accent: "slate",
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
      "Advanced DCA & AI agents",
      "Custom webhooks",
      "Priority finality lane",
    ],
    cta: { label: "Upgrade — sign in", href: "/auth?redirect=/app/billing" },
    featured: true,
    Icon: Rocket,
    accent: "violet",
  },
  {
    name: "Max",
    tagline: "Enterprise nexus",
    price: "$199",
    period: "/mo",
    blurb: "Dedicated capacity, white-glove onboarding, and bespoke RPCs.",
    features: [
      "Unlimited vaults",
      "Unlimited teammates",
      "Dedicated AI compute",
      "White-glove integration",
      "Dedicated RPC endpoints",
    ],
    cta: { label: "Upgrade — sign in", href: "/auth?redirect=/app/billing" },
    Icon: Building2,
    accent: "fuchsia",
  },
];

const guarantees = [
  {
    Icon: ShieldCheck,
    title: "Non-custodial by default",
    body: "Keys stay with your multisig. dreyv never holds funds or co-signs without you.",
  },
  {
    Icon: Zap,
    title: "Simulate before you sign",
    body: "Every intent runs on a fork first, with readable impact for every approver.",
  },
  {
    Icon: Users,
    title: "Built for squads",
    body: "Roles, approvals, and audit trails designed for the way real treasuries operate.",
  },
];

export default function PricingPage() {
  return (
    <div className="dreyv-marketing-root relative min-h-dvh w-full scroll-smooth font-manrope bg-white text-slate-900">
      {/* Ambient light background */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div className="absolute top-[-12%] left-[-10%] h-[620px] w-[620px] rounded-full bg-violet-400/[0.10] blur-[130px]" />
        <div className="absolute top-[18%] right-[-6%] h-[520px] w-[520px] rounded-full bg-fuchsia-400/[0.08] blur-[120px]" />
        <div className="absolute top-[55%] left-[40%] h-[380px] w-[380px] rounded-full bg-violet-300/[0.07] blur-[100px]" />
        <div className="absolute inset-0 noise-overlay opacity-[0.025]" />
      </div>

      <SiteHeader />

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-28 md:pt-32 pb-12 md:pb-16">
          <div className="text-center max-w-2xl mx-auto">
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-200/70 bg-white/70 backdrop-blur px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
              <Sparkles className="h-3.5 w-3.5" />
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
              <Link href="/legal/refunds" className="text-violet-600 font-medium hover:underline">
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

        {/* Guarantees */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-24">
          <div className="rounded-3xl border border-violet-200/60 bg-white/70 backdrop-blur-md p-8 md:p-10 shadow-[0_20px_60px_-30px_rgba(124,58,237,0.25)]">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {guarantees.map(({ Icon, title, body }) => (
                <div key={title} className="flex flex-col items-start">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 border border-violet-100">
                    <Icon className="h-5 w-5 text-violet-600" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
                  <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Mini FAQ / CTA strip */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-24">
          <div className="rounded-3xl bg-gradient-to-br from-violet-600 to-fuchsia-600 p-8 md:p-10 text-white flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-[0_30px_80px_-30px_rgba(124,58,237,0.45)]">
            <div className="max-w-xl">
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
                Need something custom?
              </h2>
              <p className="mt-2 text-violet-100/90 text-sm md:text-base leading-relaxed">
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
  const { Icon, featured } = tier;

  if (featured) {
    return (
      <div className="relative rounded-3xl p-[1.5px] bg-gradient-to-b from-violet-500 via-fuchsia-500 to-violet-500 shadow-[0_30px_70px_-25px_rgba(124,58,237,0.35)]">
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white shadow-md">
          Most popular
        </span>
        <div className="rounded-[calc(1.5rem-1.5px)] bg-white p-7 flex flex-col h-full">
          <TierBody tier={tier} Icon={Icon} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white/80 backdrop-blur p-7 flex flex-col shadow-[0_10px_40px_-20px_rgba(15,23,42,0.15)] hover:shadow-[0_18px_50px_-20px_rgba(124,58,237,0.25)] hover:border-violet-200 transition-all">
      <TierBody tier={tier} Icon={Icon} />
    </div>
  );
}

function TierBody({
  tier,
  Icon,
}: {
  tier: Tier;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  const isFeatured = tier.featured;
  const iconWrap = isFeatured
    ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white border-transparent"
    : "bg-violet-50 text-violet-600 border-violet-100";

  return (
    <>
      <div className="flex items-center gap-3 mb-5">
        <div
          className={`h-11 w-11 rounded-xl border flex items-center justify-center ${iconWrap}`}
        >
          <Icon className="h-5 w-5" />
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
            : "mt-8 inline-flex w-full justify-center items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-800 hover:border-violet-300 hover:text-violet-700 transition-colors"
        }
      >
        {tier.cta.label}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </>
  );
}
