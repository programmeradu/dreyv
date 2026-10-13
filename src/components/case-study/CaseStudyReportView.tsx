/**
 * CaseStudyReport — pitch-ready visual layout for /case/[address].
 *
 * Stitch-light aesthetic (matches /pricing): white bg, Manrope, solid
 * violet accents, violet-200 borders, ambient violet glows. Counterfactual
 * framing is explicit at the top so it screenshots honestly into the deck.
 */

import Link from "next/link";
import { ArrowUpRight, ArrowRight, ShieldAlert, Wallet, TrendingUp, Activity, Users, Eye } from "lucide-react";
import type { CaseStudyReport, CaseStudyFinding } from "@/lib/case-study/builder";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";

function fmtUsd(n: number, compact = false): string {
  if (!isFinite(n)) return "$0";
  const abs = Math.abs(n);
  if (compact) {
    if (abs >= 1_000_000_000) return `$${(abs / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `$${(abs / 1_000).toFixed(1)}k`;
  }
  return `$${Math.round(abs).toLocaleString()}`;
}

function severityRing(s: CaseStudyFinding["severity"]) {
  if (s === "high") return "border-violet-600";
  if (s === "medium") return "border-violet-300";
  return "border-violet-100";
}

function severityChip(s: CaseStudyFinding["severity"]) {
  if (s === "high") return { label: "High signal", cls: "bg-violet-600 text-white" };
  if (s === "medium") return { label: "Medium signal", cls: "bg-violet-100 text-violet-700" };
  return { label: "Low signal", cls: "bg-violet-50 text-violet-600" };
}

const CATEGORY_ICON: Record<CaseStudyFinding["category"], React.ComponentType<{ className?: string }>> = {
  idle: TrendingUp,
  fees: Activity,
  concentration: ShieldAlert,
  counterparty: Users,
  approvals: ShieldAlert,
  dust: Wallet,
  missed: Eye,
  stale: Activity,
};

export function CaseStudyReportView({ report }: { report: CaseStudyReport }) {
  const shortAddr = `${report.address.slice(0, 4)}…${report.address.slice(-4)}`;
  const totalUpside = report.headline.totalAnnualUsd + report.headline.totalOneTimeUsd;
  const solscan = `https://solscan.io/account/${report.address}`;

  return (
    <div className="bg-white font-manrope text-slate-900">
      {/* Disclosure / framing */}
      <div className="border-b border-violet-100 bg-violet-50/40">
        <div className="mx-auto max-w-5xl px-6 py-3 text-[12px] text-slate-600">
          <span className="font-semibold text-violet-700">Counterfactual analysis on public on-chain data.</span>
          {" "}This treasury is not affiliated with dreyv. Every figure is sourced from live mainnet data — Helius, Jupiter, and Solana RPC.
        </div>
      </div>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-violet-100">
        <span aria-hidden className="pointer-events-none absolute -top-32 -left-32 h-[24rem] w-[24rem] rounded-full bg-violet-300/30 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-32 -right-24 h-[28rem] w-[28rem] rounded-full bg-violet-400/20 blur-3xl" />

        <div className="relative mx-auto max-w-5xl px-6 pt-16 pb-12">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
            <DreyvStar size={10} />
            <span>Case Study</span>
            {report.kind && (
              <>
                <span className="text-violet-300">·</span>
                <span>{report.kind}</span>
              </>
            )}
            <span className="text-violet-300">·</span>
            <span>Solana</span>
          </div>

          <h1 className="mt-4 text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">
            {report.label}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <code className="rounded-md bg-violet-50 px-2 py-1 font-mono text-[12px] text-violet-700">{shortAddr}</code>
            <Link href={solscan} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-violet-700">
              View on Solscan <ArrowUpRight className="h-3 w-3" />
            </Link>
            <span className="text-violet-300">·</span>
            <span>Snapshot {new Date(report.generatedAt).toUTCString().replace("GMT", "UTC")}</span>
          </div>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
            What dreyv would have caught on this treasury — quantified, sourced, and ready to act on.
          </p>

          {/* Headline numbers */}
          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-violet-200 bg-white p-6">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">Annual upside dreyv unlocks</div>
              <div className="mt-2 text-4xl font-bold tracking-tight">{fmtUsd(report.headline.totalAnnualUsd, true)}</div>
              <div className="mt-1 text-xs text-slate-500">Recurring — idle yield + fee leak recovered every year</div>
            </div>
            <div className="rounded-3xl border border-violet-200 bg-white p-6">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">One-time recovery</div>
              <div className="mt-2 text-4xl font-bold tracking-tight">{fmtUsd(report.headline.totalOneTimeUsd, true)}</div>
              <div className="mt-1 text-xs text-slate-500">Reclaim from dust accounts + structural cleanup</div>
            </div>
            <div className="rounded-3xl border-2 border-violet-600 bg-violet-600 p-6 text-white">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-100">Findings surfaced</div>
              <div className="mt-2 text-4xl font-bold tracking-tight">{report.headline.findingCount}</div>
              <div className="mt-1 text-xs text-violet-100">Visible + hidden + unrealised — no public dashboard surfaces this</div>
            </div>
          </div>
        </div>
      </section>

      {/* Snapshot row */}
      <section className="border-b border-violet-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4 lg:grid-cols-6">
            <SnapshotStat label="Total value" value={fmtUsd(report.snapshot.totalUsd, true)} />
            <SnapshotStat label="Holdings" value={String(report.snapshot.holdingCount)} />
            <SnapshotStat
              label="Top asset"
              value={report.snapshot.topAsset ? `${report.snapshot.topAsset.symbol} ${(report.snapshot.topAsset.pctUsd * 100).toFixed(0)}%` : "—"}
            />
            <SnapshotStat label="Custody" value={report.snapshot.isMultisig ? `${report.snapshot.signerCount}-sig` : "Single key"} />
            <SnapshotStat label="Tx · 30d" value={String(report.snapshot.txCount30d)} />
            <SnapshotStat label="Counterparties" value={String(report.snapshot.uniqueCounterparties)} />
          </div>
        </div>
      </section>

      {/* Findings */}
      <section className="border-b border-violet-100">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="mb-8 flex items-center gap-2 text-violet-700">
            <DreyvStar size={10} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">What dreyv caught</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            {report.findings.length} findings on a treasury that looks fine from the outside.
          </h2>

          {report.findings.length === 0 ? (
            <p className="mt-8 text-slate-500">
              No findings surfaced. This treasury is either dormant or already running with policies tighter than dreyv's defaults — rare, and worth a conversation.
            </p>
          ) : (
            <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
              {report.findings.map((f) => {
                const Icon = CATEGORY_ICON[f.category] ?? Activity;
                const chip = severityChip(f.severity);
                return (
                  <article
                    key={f.id}
                    className={`flex flex-col rounded-3xl border-2 ${severityRing(f.severity)} bg-white p-6`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-50 text-violet-700">
                          <Icon className="h-4 w-4" />
                        </span>
                        <h3 className="text-base font-semibold tracking-tight">{f.title}</h3>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${chip.cls}`}>
                        {chip.label}
                      </span>
                    </div>

                    <div className="mt-5 text-3xl font-bold tracking-tight text-violet-700">{f.headline}</div>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">{f.detail}</p>

                    {f.evidence.length > 0 && (
                      <ul className="mt-4 space-y-1.5 border-t border-violet-100 pt-4 text-[12px] text-slate-500">
                        {f.evidence.slice(0, 4).map((e, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <DreyvStar size={8} className="mt-1 shrink-0" />
                            <span>{e}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Recommendations */}
      <section className="border-b border-violet-100 bg-violet-50/40">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="mb-8 flex items-center gap-2 text-violet-700">
            <DreyvStar size={10} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">What dreyv would do</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Six concrete moves. All non-custodial. All proposed before they execute.
          </h2>

          <div className="mt-10 space-y-3">
            {report.recommendations.map((r, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-3xl border border-violet-200 bg-white p-6 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-violet-600 text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-base font-semibold tracking-tight">{r.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{r.rationale}</p>
                  </div>
                </div>
                {r.expectedImpactUsd != null && r.expectedImpactUsd > 0 && (
                  <div className="shrink-0 text-right">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">Expected impact</div>
                    <div className="text-xl font-bold tracking-tight">{fmtUsd(r.expectedImpactUsd, true)}<span className="ml-1 text-xs font-normal text-slate-500">/ yr</span></div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {totalUpside > 0 && (
            <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-3xl border-2 border-violet-600 bg-violet-600 p-6 text-white">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-100">Total addressable upside on this treasury</div>
                <div className="mt-1 text-3xl font-bold tracking-tight">{fmtUsd(totalUpside, true)}</div>
              </div>
              <Link href="/auth?redirect=/app" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-50">
                Run this on my treasury <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Sources + gaps */}
      <section className="border-b border-violet-100">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <div>
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">Data sources</div>
              <ul className="space-y-1.5 text-sm text-slate-600">
                {report.sources.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <DreyvStar size={8} className="mt-1.5 shrink-0" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
            {report.gaps.length > 0 && (
              <div>
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Gaps</div>
                <ul className="space-y-1.5 text-sm text-slate-500">
                  {report.gaps.map((g, i) => (
                    <li key={i}>· {g}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-white">
        <div className="mx-auto flex max-w-5xl flex-col items-start gap-4 px-6 py-16 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Want this report on your treasury?</h2>
            <p className="mt-2 text-slate-600">dreyv runs this analysis live, every 15 minutes, with policy-gated execution.</p>
          </div>
          <Link href="/auth?redirect=/app" className={marketingPrimaryCtaSm}>
            Start free <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function SnapshotStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">{label}</div>
      <div className="mt-1 text-base font-semibold tracking-tight text-slate-900">{value}</div>
    </div>
  );
}
