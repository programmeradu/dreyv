"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  RefreshCw,
  AlertTriangle,
  Users,
  CreditCard,
  Zap,
  ShieldCheck,
  Wallet,
  ArrowLeft,
} from "lucide-react";

type Row = Record<string, any>;
type ActivityData = {
  fetchedAt: string;
  signups: { totals: { total: number; last24h: number; last7d: number }; recent: Row[] };
  payments: {
    totals: {
      total: number;
      paid: number;
      pending: number;
      failed: number;
      gross24h: number;
      gross7d: number;
      grossAll: number;
    };
    recent: Row[];
  };
  usage: {
    totals: { calls24h: number; errors24h: number; credits24h: number; keys24h: number };
    recent: Row[];
    topUsers: Row[];
  };
  audit: { recent: Row[] };
  errors: { recent: Row[] };
  balances: {
    totals: { wallets: number; funded: number; totalMinor: string };
    recentLedger: Row[];
  };
};

const fmtUsd = (n: number | string | null | undefined) =>
  "$" +
  (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const fmtInt = (n: number | string | null | undefined) =>
  (Number(n) || 0).toLocaleString();
const short = (s?: string | null, n = 8) =>
  !s ? "—" : s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;
const rel = (d?: string | null) => {
  if (!d) return "—";
  const ms = Date.now() - new Date(d).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const day = Math.floor(h / 24);
  return `${day}d ago`;
};

export default function AdminActivityPage() {
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = async () => {
    try {
      setError(null);
      const res = await fetch("/api/admin/activity", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403)
          throw new Error("Admin access required.");
        throw new Error(`Failed (${res.status})`);
      }
      setData(await res.json());
      setRefreshedAt(new Date());
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (error) {
    return (
      <Shell>
        <div className="mx-auto max-w-md mt-24 rounded-3xl border border-rose-200 bg-white p-8 text-center">
          <AlertTriangle className="mx-auto text-rose-600" />
          <h1 className="mt-3 text-xl font-semibold">Access denied</h1>
          <p className="mt-1 text-sm text-slate-600">{error}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="sticky top-0 z-20 border-b border-violet-100 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-[1500px] px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/app/admin"
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-violet-700"
            >
              <ArrowLeft size={14} /> Admin
            </Link>
            <span className="text-slate-300">/</span>
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-violet-100 border border-violet-200 text-violet-700 flex items-center justify-center">
                <Activity size={16} />
              </div>
              <div>
                <h1 className="text-base font-semibold tracking-tight">Activity</h1>
                <p className="text-[11px] text-slate-500">
                  Signups · payments · capability calls · errors
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-[10px] font-mono text-slate-500">
              {refreshedAt ? refreshedAt.toLocaleTimeString() : "—"}
            </span>
            <button
              onClick={() => {
                setLoading(true);
                load();
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-[11px] font-semibold hover:border-violet-400 hover:text-violet-700"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 sm:px-6 py-8 space-y-8">
        {/* Headline cards */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat
            icon={<Users size={14} />}
            label="Signups 24h"
            value={fmtInt(data?.signups.totals.last24h)}
            sub={`${fmtInt(data?.signups.totals.total)} total`}
          />
          <Stat
            icon={<CreditCard size={14} />}
            label="Paid revenue 24h"
            value={fmtUsd(data?.payments.totals.gross24h)}
            sub={`${fmtInt(data?.payments.totals.paid)} paid · ${fmtInt(data?.payments.totals.failed)} failed`}
            accent
          />
          <Stat
            icon={<Zap size={14} />}
            label="API calls 24h"
            value={fmtInt(data?.usage.totals.calls24h)}
            sub={`${fmtInt(data?.usage.totals.errors24h)} errors · ${fmtInt(data?.usage.totals.keys24h)} keys`}
          />
          <Stat
            icon={<Wallet size={14} />}
            label="Agent balances"
            value={fmtInt(data?.balances.totals.funded)}
            sub={`${fmtInt(data?.balances.totals.wallets)} wallets`}
          />
        </section>

        {/* Recent signups */}
        <Panel icon={<Users size={14} />} title="Recent signups">
          <Table
            head={["Wallet / email", "Tier", "Onboarded", "Joined"]}
            empty="No signups yet"
            rows={(data?.signups.recent ?? []).map((u) => [
              <div key="u" className="min-w-0">
                <div className="font-mono text-[11px] text-slate-700 truncate">
                  {short(u.wallet, 6)}
                </div>
                <div className="text-[11px] text-slate-500 truncate">{u.email ?? "—"}</div>
              </div>,
              <Badge key="t" tone={u.tier === "free" ? "slate" : "violet"}>{u.tier}</Badge>,
              u.onboarded ? (
                <Badge key="o" tone="emerald">yes</Badge>
              ) : (
                <Badge key="o" tone="slate">no</Badge>
              ),
              <span key="d" className="text-[11px] text-slate-500">{rel(u.createdAt)}</span>,
            ])}
          />
        </Panel>

        {/* Agent payments */}
        <Panel
          icon={<CreditCard size={14} />}
          title="Agent payments"
          right={
            <span className="text-[11px] text-slate-500">
              Gross all-time {fmtUsd(data?.payments.totals.grossAll)}
            </span>
          }
        >
          <Table
            head={["SKU", "Rail", "Amount", "Status", "Created"]}
            empty="No agent payments yet"
            rows={(data?.payments.recent ?? []).map((p) => [
              <span key="s" className="font-mono text-[11px] truncate block max-w-[200px]">
                {p.sku}
              </span>,
              <Badge key="r" tone="violet">{p.rail}</Badge>,
              <span key="a" className="font-semibold text-slate-900">{fmtUsd(p.amountUsd)}</span>,
              <Badge
                key="st"
                tone={
                  p.status === "paid"
                    ? "emerald"
                    : p.status === "pending"
                      ? "amber"
                      : "rose"
                }
              >
                {p.status}
              </Badge>,
              <span key="d" className="text-[11px] text-slate-500">{rel(p.createdAt)}</span>,
            ])}
          />
        </Panel>

        {/* Top users + recent errors */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Panel icon={<Zap size={14} />} title="Top users by API calls (7d)">
            <Table
              head={["User", "Calls", "Errors", "Credits"]}
              empty="No usage yet"
              rows={(data?.usage.topUsers ?? []).map((u) => [
                <span key="u" className="font-mono text-[11px]">{short(u.userId, 6)}</span>,
                fmtInt(u.calls),
                <span key="e" className={u.errors > 0 ? "text-rose-600 font-semibold" : ""}>
                  {fmtInt(u.errors)}
                </span>,
                fmtInt(Math.round(Number(u.credits) || 0)),
              ])}
            />
          </Panel>

          <Panel
            icon={<AlertTriangle size={14} />}
            title="Recent capability errors"
            tone="rose"
          >
            <Table
              head={["Capability", "Outcome", "Error", "When"]}
              empty="No errors — nice."
              rows={(data?.errors.recent ?? []).map((e) => [
                <span key="c" className="font-mono text-[11px] truncate block max-w-[180px]">
                  {e.capabilityId}
                </span>,
                <Badge key="o" tone="rose">{e.outcome}</Badge>,
                <span key="er" className="text-[11px] text-slate-600 truncate block max-w-[180px]">
                  {e.errorCode ?? "—"}
                </span>,
                <span key="t" className="text-[11px] text-slate-500">{rel(e.createdAt)}</span>,
              ])}
            />
          </Panel>
        </div>

        {/* Recent API calls + audit log */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Panel icon={<Zap size={14} />} title="Recent API calls">
            <Table
              head={["Capability", "Transport", "Status", "ms", "When"]}
              empty="No calls yet"
              rows={(data?.usage.recent ?? []).map((u) => [
                <span key="c" className="font-mono text-[11px] truncate block max-w-[180px]">
                  {u.capabilityId}
                </span>,
                <Badge key="t" tone="slate">{u.transport}</Badge>,
                <Badge
                  key="s"
                  tone={u.status === "ok" ? "emerald" : "rose"}
                >
                  {u.status}
                </Badge>,
                <span key="ms" className="text-[11px] text-slate-500">
                  {u.latencyMs ?? "—"}
                </span>,
                <span key="d" className="text-[11px] text-slate-500">{rel(u.ts)}</span>,
              ])}
            />
          </Panel>

          <Panel icon={<ShieldCheck size={14} />} title="Audit log (tamper-evident)">
            <Table
              head={["Action", "Target", "When"]}
              empty="No audit entries"
              rows={(data?.audit.recent ?? []).map((a) => [
                <span key="a" className="font-mono text-[11px]">{a.action}</span>,
                <span key="t" className="text-[11px] text-slate-600 truncate block max-w-[240px]">
                  {a.target ?? "—"}
                </span>,
                <span key="d" className="text-[11px] text-slate-500">{rel(a.ts)}</span>,
              ])}
            />
          </Panel>
        </div>

        {/* Balance ledger */}
        <Panel icon={<Wallet size={14} />} title="Recent balance movements">
          <Table
            head={["User", "Reason", "Δ (minor)", "Balance after", "When"]}
            empty="No balance movements yet"
            rows={(data?.balances.recentLedger ?? []).map((l) => [
              <span key="u" className="font-mono text-[11px]">{short(l.userId, 6)}</span>,
              <Badge key="r" tone="slate">{l.reason}</Badge>,
              <span
                key="d"
                className={
                  Number(l.deltaMinor) >= 0
                    ? "text-emerald-700 font-semibold"
                    : "text-rose-700 font-semibold"
                }
              >
                {Number(l.deltaMinor) >= 0 ? "+" : ""}
                {fmtInt(l.deltaMinor)}
              </span>,
              <span key="b" className="font-mono text-[11px]">{fmtInt(l.balanceAfter)}</span>,
              <span key="t" className="text-[11px] text-slate-500">{rel(l.createdAt)}</span>,
            ])}
          />
        </Panel>
      </main>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="dreyv-marketing-root relative min-h-dvh w-full font-manrope bg-white text-slate-900 overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden>
        <div className="absolute top-[-12%] left-[-10%] h-[620px] w-[620px] rounded-full bg-violet-400/[0.10] blur-[130px]" />
        <div className="absolute top-[20%] right-[-6%] h-[520px] w-[520px] rounded-full bg-violet-300/[0.08] blur-[120px]" />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl border ${accent ? "border-violet-300 bg-violet-50/40" : "border-violet-100 bg-white"} p-4`}
    >
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span className="text-violet-700">{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Panel({
  icon,
  title,
  tone = "violet",
  right,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tone?: "violet" | "rose";
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const border = tone === "rose" ? "border-rose-100" : "border-violet-100";
  const iconBg =
    tone === "rose"
      ? "bg-rose-50 border-rose-100 text-rose-600"
      : "bg-violet-100 border-violet-200 text-violet-700";
  return (
    <section className={`rounded-3xl border ${border} bg-white overflow-hidden`}>
      <div className="px-5 py-3.5 border-b border-violet-50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className={`h-7 w-7 rounded-lg border flex items-center justify-center ${iconBg}`}>
            {icon}
          </div>
          <h3 className="text-[13px] font-semibold tracking-tight text-slate-900">{title}</h3>
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Table({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: React.ReactNode[][];
  empty: string;
}) {
  if (!rows.length)
    return (
      <div className="py-6 text-center text-[12px] text-slate-400">{empty}</div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {head.map((h) => (
              <th key={h} className="px-2 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-t border-violet-50">
              {cells.map((c, j) => (
                <td key={j} className="px-2 py-2 align-top text-[12px] text-slate-700">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({
  children,
  tone = "violet",
}: {
  children: React.ReactNode;
  tone?: "violet" | "emerald" | "rose" | "amber" | "slate";
}) {
  const map: Record<string, string> = {
    violet: "bg-violet-50 border-violet-200 text-violet-700",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    rose: "bg-rose-50 border-rose-200 text-rose-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    slate: "bg-slate-50 border-slate-200 text-slate-600",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${map[tone]}`}
    >
      {children}
    </span>
  );
}
