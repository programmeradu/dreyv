"use client";

/**
 * Public vault preview — client surface.
 *
 * Receives server-fetched holdings + fees + yield + audit and renders a
 * conversion-tuned read-only dashboard. Each finding ships with an
 * "auto-execute when I sign in" CTA that deep-links to /auth?intent=...
 * and round-trips the action into the signed-in CommandBar.
 */

import Link from "next/link";
import { useMemo } from "react";

interface Holding {
  mint: string;
  symbol: string;
  name?: string;
  balance: string;
  amount?: string;
  decimals: number;
  logo?: string;
}

interface FeesPayload {
  totalFeeUsd?: number;
  totalFeeSol?: number;
  transactionCount?: number;
  byType?: Array<{ type: string; totalFees: number; count: number }>;
  daily?: Array<{ date: string; totalFees: number; txCount: number }>;
}

interface YieldRateEntry {
  apy: number;
  source: "live" | "estimated";
  protocol: string;
  symbol: string;
  riskTier: "low" | "medium" | "high";
  aumUsd?: number;
}

interface SecurityAudit {
  score: number;
  findings: Array<{ severity: "info" | "warn" | "high"; code: string; message: string }>;
  isMultisig: boolean;
  threshold: number | null;
  signers: Array<{ address: string; label?: string }>;
}

interface PublicVaultClientProps {
  address: string;
  data: {
    holdings: Holding[];
    fees: FeesPayload | null;
    yieldRates: Record<string, YieldRateEntry>;
    audit: SecurityAudit | null;
  };
}

function fmtUsd(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function fmtAum(usd?: number): string {
  if (typeof usd !== "number" || !Number.isFinite(usd)) return "—";
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(0)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`;
  return `$${usd.toFixed(0)}`;
}

function authHref(intent: string, address: string, params?: Record<string, string>): string {
  const qs = new URLSearchParams({ intent, vault: address, ...(params ?? {}) });
  return `/auth?${qs.toString()}`;
}

const RISK_TONE: Record<"low" | "medium" | "high", string> = {
  low: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-rose-50 text-rose-700 border-rose-200",
};

export function PublicVaultClient({ address, data }: PublicVaultClientProps) {
  const { holdings, fees, yieldRates, audit } = data;

  const topHoldings = useMemo(() => {
    return [...holdings]
      .map((h) => {
        const decimals = h.decimals ?? 0;
        const raw = Number(h.balance ?? h.amount ?? 0);
        const human = decimals > 0 ? raw / Math.pow(10, decimals) : raw;
        return { ...h, human };
      })
      .filter((h) => h.human > 0)
      .sort((a, b) => b.human - a.human)
      .slice(0, 10);
  }, [holdings]);

  const sortedYields = useMemo(() => {
    return Object.values(yieldRates)
      .filter((r) => r.apy > 0)
      .sort((a, b) => b.apy - a.apy)
      .slice(0, 5);
  }, [yieldRates]);

  const topFeeTypes = (fees?.byType ?? []).slice(0, 5);
  const totalFees = fees?.totalFeeUsd ?? 0;
  const txCount = fees?.transactionCount ?? 0;

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      {/* Top conversion banner */}
      <div className="mb-8 rounded-2xl border border-violet-300 bg-gradient-to-br from-violet-50 via-white to-violet-50 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">
              Read-only · zero risk
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">
              Connect to act on these opportunities
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              You&apos;re viewing public on-chain data. Sign in to let Dreyv execute, watch,
              and protect this vault.
            </p>
          </div>
          <Link
            href={authHref("open_app", address)}
            className="shrink-0 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
          >
            Connect wallet
          </Link>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Holdings" value={`${topHoldings.length}+`} sub="tokens detected" />
        <Card label="Fees paid (6mo)" value={fmtUsd(totalFees)} sub={`${txCount.toLocaleString()} txs`} />
        <Card
          label="Top yield"
          value={sortedYields[0] ? `${sortedYields[0].apy.toFixed(1)}%` : "—"}
          sub={sortedYields[0]?.protocol ?? "—"}
        />
        <Card
          label="Hygiene"
          value={audit ? `${audit.score}/100` : "—"}
          sub={audit?.isMultisig ? "Multisig" : "Single-signer"}
        />
      </div>

      {/* Holdings */}
      {topHoldings.length > 0 && (
        <Block title="Holdings">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-violet-50/60 text-left text-[11px] uppercase tracking-wider text-violet-700">
                  <th className="px-4 py-2 font-medium">Token</th>
                  <th className="px-4 py-2 font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Mint</th>
                  <th className="px-4 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {topHoldings.map((h) => (
                  <tr key={h.mint} className="border-t border-violet-100/80 hover:bg-violet-50/30">
                    <td className="px-4 py-2 align-middle font-semibold text-slate-900">{h.symbol}</td>
                    <td className="px-4 py-2 align-middle tabular-nums text-slate-700">
                      {h.human.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </td>
                    <td className="px-4 py-2 align-middle font-mono text-[11px] text-slate-500">
                      {h.mint.slice(0, 4)}…{h.mint.slice(-4)}
                    </td>
                    <td className="px-4 py-2 align-middle text-right">
                      <Link
                        href={authHref("execute_swap", address, {
                          token: h.symbol,
                          mint: h.mint,
                        })}
                        className="rounded-md border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
                      >
                        Auto-swap when I sign in
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
      )}

      {/* Yield opportunities */}
      {sortedYields.length > 0 && (
        <Block title="Yield opportunities">
          <ul className="divide-y divide-violet-100">
            {sortedYields.map((y) => (
              <li
                key={`${y.symbol}-${y.protocol}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${RISK_TONE[y.riskTier]}`}
                  >
                    {y.riskTier}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold text-slate-900">{y.symbol}</span>
                      <span className="text-xs text-slate-500">{y.protocol}</span>
                      {y.source === "live" && (
                        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-700">
                          Live
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      AUM {fmtAum(y.aumUsd)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-mono text-base font-semibold text-violet-700 tabular-nums">
                    {y.apy.toFixed(1)}%
                  </span>
                  <Link
                    href={authHref("execute_yield_deposit", address, {
                      protocol: y.protocol,
                      symbol: y.symbol,
                    })}
                    className="rounded-md border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
                  >
                    Auto-execute when I sign in
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {/* Fees breakdown */}
      {topFeeTypes.length > 0 && (
        <Block title="Fees paid (last 6 months)">
          <ul className="divide-y divide-violet-100">
            {topFeeTypes.map((t) => (
              <li
                key={t.type}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="font-semibold text-slate-900">{t.type}</p>
                  <p className="text-[11px] text-slate-500">{t.count.toLocaleString()} transactions</p>
                </div>
                <span className="font-mono text-base font-semibold text-rose-600 tabular-nums">
                  {fmtUsd(t.totalFees)}
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-violet-100 bg-violet-50/40 px-4 py-3 text-sm">
            <Link
              href={authHref("audit_fees", address)}
              className="font-semibold text-violet-700 hover:text-violet-900"
            >
              Cut these fees with Dreyv →
            </Link>
            <span className="ml-1 text-slate-500">
              we route through cheapest pools and bundle txs.
            </span>
          </div>
        </Block>
      )}

      {/* Security audit */}
      {audit && audit.findings.length > 0 && (
        <Block title="Security findings">
          <ul className="divide-y divide-violet-100">
            {audit.findings.slice(0, 6).map((f, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      f.severity === "high"
                        ? RISK_TONE.high
                        : f.severity === "warn"
                        ? RISK_TONE.medium
                        : RISK_TONE.low
                    }`}
                  >
                    {f.severity}
                  </span>
                  <p className="text-sm text-slate-700">{f.message}</p>
                </div>
                <Link
                  href={authHref("audit_security", address, { code: f.code })}
                  className="shrink-0 rounded-md border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
                >
                  Auto-fix when I sign in
                </Link>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {/* Empty / nothing-to-show */}
      {topHoldings.length === 0 && !fees && sortedYields.length === 0 && !audit && (
        <div className="mt-10 rounded-2xl border border-violet-200 bg-violet-50/40 p-8 text-center text-sm text-slate-600">
          We couldn&apos;t pull live data for this address right now. Try again in a moment, or
          paste a different vault.
        </div>
      )}

      <footer className="mt-12 border-t border-violet-200/60 pt-6 text-xs text-slate-500">
        Public read-only preview. No data is stored. {" "}
        <Link href="/" className="font-semibold text-violet-700 hover:text-violet-900">
          Back to Dreyv
        </Link>
      </footer>
    </section>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-violet-200 bg-white p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-violet-700">{label}</div>
      <div className="mt-2 text-xl font-semibold text-slate-900 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
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
