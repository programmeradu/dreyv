/**
 * /marketplace/[appId] — Mini-App detail page.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { miniApps } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { SiteHeader } from "@/components/home/site-header";
import { SiteFooter } from "@/components/home/site-footer";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { ArrowLeft, Shield, Download, Star, ExternalLink } from "lucide-react";

export const revalidate = 60;

async function getApp(appId: string) {
  if (!db) return null;
  const [row] = await db
    .select()
    .from(miniApps)
    .where(and(eq(miniApps.id, appId), eq(miniApps.isPublished, true)))
    .limit(1);
  return row ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ appId: string }>;
}): Promise<Metadata> {
  const { appId } = await params;
  const app = await getApp(appId);
  if (!app) return { title: "Mini-App not found" };
  return {
    title: `${app.name} — Dreyv Marketplace`,
    description: app.description,
    alternates: { canonical: `/marketplace/${app.id}` },
    openGraph: {
      type: "website",
      url: `/marketplace/${app.id}`,
      title: `${app.name} | Dreyv Mini-App`,
      description: app.description,
      siteName: "dreyv",
    },
  };
}

export default async function MiniAppDetailPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = await params;
  const app = await getApp(appId);
  if (!app) notFound();

  const price = Number(app.priceUsdc ?? 0);
  const rating = app.rating != null ? Number(app.rating) : null;
  const tagsRaw = app.tags as unknown;
  const tags = Array.isArray(tagsRaw) ? (tagsRaw as string[]) : [];

  return (
    <div className="min-h-screen bg-white text-slate-900 font-manrope">
      <SiteHeader />

      <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[560px] rounded-full bg-violet-300/20 blur-[140px]" />
      </div>

      <main className="relative z-10 mx-auto max-w-5xl px-6 pt-12 pb-24">
        <Link
          href="/marketplace"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-violet-700 mb-8"
        >
          <ArrowLeft size={14} /> Back to marketplace
        </Link>

        <header className="flex flex-col md:flex-row gap-6 items-start mb-10">
          <div className="h-20 w-20 rounded-3xl bg-violet-100 border border-violet-200 flex items-center justify-center text-violet-700 font-bold text-xl overflow-hidden shrink-0">
            {app.screenshotUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={app.screenshotUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              app.name.slice(0, 2).toUpperCase()
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
                {app.category}
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-xs text-slate-500">v{app.version}</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
              {app.name}
            </h1>
            <p className="mt-3 text-base text-slate-600 leading-relaxed max-w-2xl">
              {app.description}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <InstallButton
                app={{
                  id: app.id,
                  name: app.name,
                  description: app.description,
                  category: app.category,
                  version: app.version,
                  priceUsdc: price,
                  creatorWallet: app.creatorWallet,
                }}
              />
              {app.arweaveTxId && (
                <a
                  href={`https://arweave.net/${app.arweaveTxId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-violet-700 hover:text-violet-900 border border-violet-200 hover:border-violet-400 bg-white"
                >
                  Source on Arweave <ExternalLink size={12} />
                </a>
              )}
            </div>
          </div>
        </header>

        {/* Stats */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <Stat label="Installs" value={app.installs.toLocaleString()} icon={<Download size={14} />} />
          <Stat
            label="Rating"
            value={rating != null ? rating.toFixed(2) : "—"}
            icon={<Star size={14} />}
          />
          <Stat
            label="Security score"
            value={app.securityScore != null ? `${app.securityScore}/100` : "Unscanned"}
            icon={<Shield size={14} />}
          />
          <Stat
            label="Creator share"
            value={`${Math.round(Number(app.creatorShare ?? 0.8) * 100)}%`}
            icon={<DreyvStar size={14} className="text-violet-500" />}
          />
        </section>

        {/* Creator */}
        <section className="rounded-3xl border border-violet-200/60 bg-white p-6 mb-10">
          <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-3">
            Built by
          </h2>
          <p className="font-mono text-sm text-slate-700 break-all">{app.creatorWallet}</p>
          <p className="mt-2 text-xs text-slate-500">
            Settlement on Solana. 80% to creator, 20% to Dreyv. No platform fees beyond split.
          </p>
        </section>

        {tags.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-3">
              Tags
            </h2>
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <span
                  key={t}
                  className="px-3 py-1 rounded-full text-xs font-medium bg-violet-50 border border-violet-200 text-violet-700"
                >
                  {t}
                </span>
              ))}
            </div>
          </section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-violet-200/60 bg-white p-4">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-slate-400 font-semibold">
        <span className="text-violet-500">{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-xl font-bold text-slate-900 tabular-nums">{value}</div>
    </div>
  );
}
