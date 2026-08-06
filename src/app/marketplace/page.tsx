/**
 * /marketplace — Public Mini-App browse page.
 * Server-rendered list of published apps. Light Stitch-inspired theme.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/db";
import { miniApps } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { ArrowUpRight, Search, Shield } from "lucide-react";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Marketplace — Mini-Apps for treasury workflows",
  description:
    "Browse production-ready Dreyv Mini-Apps: swap, vault, payroll, analytics, and more. Built by the community, vetted by Dreyv.",
  alternates: { canonical: "/marketplace" },
  openGraph: {
    type: "website",
    url: "/marketplace",
    title: "Marketplace | Dreyv Mini-Apps",
    description:
      "Production-ready Mini-Apps for non-custodial treasury workflows.",
    siteName: "dreyv",
  },
};

const CATEGORIES = [
  "all",
  "utility",
  "defi",
  "analytics",
  "governance",
  "payroll",
  "trading",
] as const;

type Search = { q?: string; cat?: string };

async function fetchApps(search: Search) {
  if (!db) return [];
  const rows = await db
    .select({
      id: miniApps.id,
      name: miniApps.name,
      description: miniApps.description,
      priceUsdc: miniApps.priceUsdc,
      installs: miniApps.installs,
      rating: miniApps.rating,
      category: miniApps.category,
      creatorWallet: miniApps.creatorWallet,
      securityScore: miniApps.securityScore,
      screenshotUrl: miniApps.screenshotUrl,
      createdAt: miniApps.createdAt,
    })
    .from(miniApps)
    .where(eq(miniApps.isPublished, true))
    .orderBy(desc(miniApps.installs), desc(miniApps.createdAt))
    .limit(200);

  const q = (search.q ?? "").trim().toLowerCase();
  const cat = (search.cat ?? "all").toLowerCase();
  return rows.filter((r) => {
    if (cat !== "all" && (r.category ?? "").toLowerCase() !== cat) return false;
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      (r.description ?? "").toLowerCase().includes(q)
    );
  });
}

export const runtime = "edge";
export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const apps = await fetchApps(sp);
  const activeCat = (sp.cat ?? "all").toLowerCase();
  const q = sp.q ?? "";

  return (
    <div className="min-h-screen bg-white text-slate-900 font-manrope">
      <SiteHeader />

      {/* Ambient violet glow */}
      <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[1100px] h-[680px] rounded-full bg-violet-300/25 blur-[140px]" />
        <div className="absolute top-1/3 -right-40 w-[520px] h-[520px] rounded-full bg-violet-400/15 blur-[120px]" />
      </div>

      <main className="relative z-10 mx-auto max-w-7xl px-6 pt-16 pb-24">
        {/* Hero */}
        <header className="text-center max-w-2xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-violet-200 bg-white/70 backdrop-blur text-xs font-medium text-violet-700 mb-5">
            <DreyvStar size={12} className="text-violet-600" />
            Mini-App Marketplace
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900">
            Production-ready treasury apps,
            <br />
            <span className="text-violet-600">installable in one click.</span>
          </h1>
          <p className="mt-5 text-base text-slate-600 leading-relaxed">
            Swap, payroll, analytics, governance — built by the community,
            audited by Dreyv. 80/20 revenue split, on-chain Solana settlement.
          </p>
        </header>

        {/* Search + categories */}
        <div className="mb-8 rounded-3xl border border-violet-200/60 bg-white/80 backdrop-blur p-5 shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_8px_24px_-12px_rgba(124,58,237,0.18)]">
          <form action="/marketplace" method="GET" className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search Mini-Apps…"
                className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400"
              />
            </div>
            {activeCat !== "all" && (
              <input type="hidden" name="cat" value={activeCat} />
            )}
            <button type="submit" className={marketingPrimaryCtaSm}>
              Search
            </button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => {
              const active = cat === activeCat;
              const href =
                cat === "all"
                  ? q
                    ? `/marketplace?q=${encodeURIComponent(q)}`
                    : "/marketplace"
                  : `/marketplace?cat=${cat}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
              return (
                <Link
                  key={cat}
                  href={href}
                  className={
                    "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors " +
                    (active
                      ? "bg-violet-600 border-violet-600 text-white"
                      : "bg-white border-violet-200 text-slate-700 hover:border-violet-400 hover:text-violet-700")
                  }
                >
                  {cat}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Grid */}
        {apps.length === 0 ? (
          <EmptyState query={q} cat={activeCat} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {apps.map((app) => (
              <AppCard key={app.id} app={app} />
            ))}
          </div>
        )}

        {/* Builder CTA */}
        <section className="mt-20 rounded-3xl border border-violet-200/70 bg-gradient-to-br from-white to-violet-50/60 p-10 md:p-14 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-violet-200 bg-white text-xs font-medium text-violet-700 mb-5">
            <DreyvStar size={12} className="text-violet-600" />
            For builders
          </div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 max-w-2xl mx-auto">
            Ship a Mini-App. Keep 80% of revenue.
          </h2>
          <p className="mt-4 text-slate-600 max-w-xl mx-auto">
            Scaffold, build, and publish from Dreyv Studio. Settlement and
            payouts on Solana, no marketplace fees beyond the 20% platform
            share.
          </p>
          <div className="mt-7 flex items-center justify-center gap-3">
            <Link href="/developers" className={marketingPrimaryCtaSm}>
              Builder docs
              <ArrowUpRight size={14} />
            </Link>
            <Link
              href="/studio"
              className="px-5 py-2.5 rounded-xl text-xs font-semibold text-violet-700 hover:text-violet-900 border border-violet-200 hover:border-violet-400 bg-white transition-colors"
            >
              Open Studio
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function AppCard({
  app,
}: {
  app: {
    id: string;
    name: string;
    description: string;
    priceUsdc: string | number;
    installs: number;
    rating: string | number | null;
    category: string;
    creatorWallet: string;
    securityScore: number | null;
    screenshotUrl: string | null;
  };
}) {
  const price = Number(app.priceUsdc ?? 0);
  const rating = app.rating != null ? Number(app.rating) : null;
  const installsLabel =
    app.installs >= 1000 ? `${(app.installs / 1000).toFixed(1)}k` : `${app.installs}`;
  const initials = app.name.slice(0, 2).toUpperCase();
  const wallet = app.creatorWallet
    ? `${app.creatorWallet.slice(0, 4)}…${app.creatorWallet.slice(-4)}`
    : "—";

  return (
    <Link
      href={`/marketplace/${app.id}`}
      className="group relative flex flex-col rounded-3xl border border-violet-200/60 bg-white p-6 transition-all hover:border-violet-400 hover:shadow-[0_10px_40px_-18px_rgba(124,58,237,0.35)]"
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="h-12 w-12 rounded-2xl bg-violet-100 border border-violet-200 flex items-center justify-center text-violet-700 font-bold text-sm overflow-hidden">
          {app.screenshotUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={app.screenshotUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span
            className={
              "px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider " +
              (price === 0
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-violet-50 text-violet-700 border border-violet-200")
            }
          >
            {price === 0 ? "Free" : `${price} USDC`}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
            {app.category}
          </span>
        </div>
      </div>

      <h3 className="text-lg font-bold tracking-tight text-slate-900 group-hover:text-violet-700 transition-colors">
        {app.name}
      </h3>
      <p className="mt-1.5 text-sm text-slate-600 line-clamp-2 leading-relaxed">
        {app.description}
      </p>

      <div className="mt-5 pt-4 border-t border-violet-100 flex items-center justify-between text-xs text-slate-500">
        <span className="font-mono">{wallet}</span>
        <div className="flex items-center gap-3">
          {app.securityScore != null && (
            <span className="inline-flex items-center gap-1">
              <Shield size={12} className="text-violet-500" />
              {app.securityScore}
            </span>
          )}
          {rating != null && <span>★ {rating.toFixed(1)}</span>}
          <span>{installsLabel} installs</span>
        </div>
      </div>
    </Link>
  );
}

function EmptyState({ query, cat }: { query: string; cat: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-violet-200 bg-white/70 p-16 text-center">
      <DreyvStar size={28} className="mx-auto text-violet-400 mb-4" />
      <h3 className="text-lg font-semibold text-slate-900">
        No Mini-Apps match{query ? ` "${query}"` : ""}{cat !== "all" ? ` in ${cat}` : ""}.
      </h3>
      <p className="mt-2 text-sm text-slate-500">
        Try a broader search or browse all categories.
      </p>
      <Link
        href="/marketplace"
        className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:text-violet-900"
      >
        Reset filters
      </Link>
    </div>
  );
}
