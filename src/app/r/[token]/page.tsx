/**
 * Public treasury report viewer — /r/[token]
 *
 * Renders a published, unrevoked report fetched from
 * `GET /api/treasury/reports?token=…`. No auth required. Read-only.
 * Shows: title, period, vault, generated time, summary metrics, and
 * tables for transactions / proposals / policy actions when present.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSiteUrl } from "@/lib/seo/site";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ReportPayload {
  title: string;
  vaultAddress: string;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  snapshot: Record<string, unknown> | null;
}

async function fetchReport(token: string): Promise<{ ok: boolean; status?: number; report?: ReportPayload; error?: string }> {
  const base = getSiteUrl();
  const res = await fetch(`${base}/api/treasury/reports?token=${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    let err: string | undefined;
    try { err = (await res.json())?.error; } catch {}
    return { ok: false, status: res.status, error: err };
  }
  const json = await res.json();
  return { ok: true, report: json.report };
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const r = await fetchReport(token);
  const title = r.ok && r.report?.title ? `${r.report.title} · Dreyv` : "Treasury report · Dreyv";
  return {
    title,
    description: "Public, read-only treasury report shared via Dreyv.",
    robots: { index: false, follow: false },
  };
}

function fmtDate(s?: string | null) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return s; }
}
function fmtUsd(n: unknown) {
  if (n == null || typeof n !== "number" || !isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function fmtNum(n: unknown, digits = 4) {
  if (n == null || typeof n !== "number" || !isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}
function shortAddr(s?: string | null) {
  if (!s) return "—";
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
}

export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await fetchReport(token);
  if (!r.ok) {
    if (r.status === 410) {
      return <ExpiredOrRevoked kind="expired" />;
    }
    if (r.status === 404) notFound();
    return <ExpiredOrRevoked kind="revoked" />;
  }
  const report = r.report!;
  const snap = (report.snapshot ?? {}) as Record<string, any>;
  const summary = (snap.summary ?? {}) as Record<string, any>;
  const transactions: any[] = Array.isArray(snap.transactions) ? snap.transactions : [];
  const proposals: any[] = Array.isArray(snap.proposals) ? snap.proposals : [];
  const policyActions: any[] = Array.isArray(snap.policyActions) ? snap.policyActions : [];

  const period = report.periodStart || report.periodEnd
    ? `${fmtDate(report.periodStart)} → ${fmtDate(report.periodEnd)}`
    : (snap.period as string | undefined) ?? "All time";

  return (
    <main className="min-h-screen bg-white text-slate-900 font-[Manrope]">
      {/* Ambient violet glow header */}
      <div className="relative overflow-hidden border-b border-violet-200/60">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-violet-400/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-10 h-[260px] w-[420px] rounded-full bg-violet-300/30 blur-3xl" />
        <div className="relative mx-auto max-w-5xl px-6 py-12">
          <div className="flex items-center justify-between gap-4 text-xs uppercase tracking-[0.18em] text-violet-700">
            <Link href="/" className="font-semibold">Dreyv</Link>
            <span className="rounded-full border border-violet-300 bg-white/70 px-3 py-1 text-[10px]">Public report</span>
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            {report.title}
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            Vault <span className="font-mono text-slate-800">{shortAddr(report.vaultAddress)}</span>
            {" · "}Period {period}
            {" · "}Generated {fmtDate(report.createdAt)}
          </p>
        </div>
      </div>

      <section className="mx-auto max-w-5xl px-6 py-10">
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="Transactions" value={fmtNum(summary.totalTransactions ?? transactions.length, 0)} />
          <SummaryCard label="Net flow" value={fmtUsd(summary.netFlowUsd)} />
          <SummaryCard label="Proposals" value={fmtNum(summary.totalProposals ?? proposals.length, 0)} />
          <SummaryCard label="Executed" value={fmtNum(summary.executedProposals, 0)} />
        </div>

        {/* Transactions */}
        {transactions.length > 0 && (
          <Block title="Transactions">
            <Table
              head={["Date", "Direction", "Token", "Amount", "Value (USD)", "Counterparty"]}
              rows={transactions.slice(0, 200).map((t) => [
                t.date ?? "—",
                <DirectionPill key="d" dir={t.direction} />,
                t.token ?? "—",
                fmtNum(t.amount, 6),
                fmtUsd(t.valueUsd),
                <span key="c" className="font-mono text-xs text-slate-700">{shortAddr(t.counterparty)}</span>,
              ])}
            />
            {transactions.length > 200 && (
              <p className="mt-3 text-xs text-slate-500">Showing first 200 of {transactions.length}.</p>
            )}
          </Block>
        )}

        {/* Proposals */}
        {proposals.length > 0 && (
          <Block title="Proposals">
            <Table
              head={["Date", "Title", "Type", "Status", "Value (USD)"]}
              rows={proposals.map((p) => [
                p.date ?? "—",
                <span key="t" className="text-slate-900">{p.title ?? "—"}</span>,
                p.type ?? "—",
                <StatusPill key="s" status={p.status} />,
                fmtUsd(p.valueUsd),
              ])}
            />
          </Block>
        )}

        {/* Policy actions */}
        {policyActions.length > 0 && (
          <Block title="Agent decisions">
            <Table
              head={["Date", "Capability", "Decision", "Risk", "Notes"]}
              rows={policyActions.map((a) => [
                a.date ?? "—",
                <span key="c" className="font-mono text-xs text-slate-700">{a.capability ?? "—"}</span>,
                a.decision ?? "—",
                a.riskScore != null ? fmtNum(a.riskScore, 2) : "—",
                <span key="n" className="text-slate-600">{a.notes ?? "—"}</span>,
              ])}
            />
          </Block>
        )}

        {transactions.length === 0 && proposals.length === 0 && policyActions.length === 0 && (
          <div className="mt-10 rounded-2xl border border-violet-200 bg-violet-50/40 p-8 text-center text-sm text-slate-600">
            This report is empty — no transactions, proposals, or agent decisions in the selected period.
          </div>
        )}

        <footer className="mt-12 border-t border-violet-200/60 pt-6 text-xs text-slate-500">
          Shared via <Link href="/" className="font-semibold text-violet-700 hover:text-violet-900">Dreyv</Link> · Read-only · This link can be revoked at any time by the vault owner.
        </footer>
      </section>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-violet-200 bg-white p-4 shadow-[0_1px_0_rgba(124,58,237,0.04)]">
      <div className="text-[10px] uppercase tracking-[0.18em] text-violet-700">{label}</div>
      <div className="mt-2 text-xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">{title}</h2>
      <div className="mt-3 overflow-hidden rounded-2xl border border-violet-200 bg-white">
        {children}
      </div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="bg-violet-50/60 text-left text-[11px] uppercase tracking-wider text-violet-700">
            {head.map((h) => (<th key={h} className="px-4 py-2 font-medium">{h}</th>))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-violet-100/80 hover:bg-violet-50/30">
              {r.map((cell, j) => (<td key={j} className="px-4 py-2 align-middle">{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DirectionPill({ dir }: { dir?: string }) {
  const d = (dir ?? "").toLowerCase();
  const cls =
    d === "in" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : d === "out" ? "bg-rose-50 text-rose-700 border-rose-200"
    : "bg-slate-50 text-slate-600 border-slate-200";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{d || "—"}</span>;
}
function StatusPill({ status }: { status?: string }) {
  const s = (status ?? "").toLowerCase();
  const cls =
    s === "acted" || s === "executed" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : s === "rejected" || s === "failed" ? "bg-rose-50 text-rose-700 border-rose-200"
    : "bg-violet-50 text-violet-700 border-violet-200";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status ?? "—"}</span>;
}

function ExpiredOrRevoked({ kind }: { kind: "expired" | "revoked" }) {
  return (
    <main className="min-h-screen bg-white font-[Manrope]">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-violet-400/20 blur-3xl" />
        <div className="relative mx-auto flex max-w-2xl flex-col items-center px-6 py-24 text-center">
          <span className="rounded-full border border-violet-300 bg-white/70 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-violet-700">
            {kind === "expired" ? "Link expired" : "Link revoked"}
          </span>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900">
            This report is no longer available
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            {kind === "expired"
              ? "The share link has reached its expiry date."
              : "The vault owner has revoked access to this report."}{" "}
            Ask whoever shared it to publish a fresh link.
          </p>
          <Link href="/" className="mt-8 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700">
            Go to Dreyv
          </Link>
        </div>
      </div>
    </main>
  );
}
