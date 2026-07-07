"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useWallet } from "@/lib/wallet/compat";
import { RiskChip } from "@/components/webacy/RiskChip";
import { revokeApproval } from "@/lib/webacy/revoke";
import type { RiskScore } from "@/lib/webacy/types";
import { ShieldCheck, ExternalLink, Loader2, RefreshCw, AlertCircle } from "lucide-react";

interface ApprovalRow {
  token: string;
  spender: string;
  amount: string;
  risk: RiskScore;
}

type RevokeState = "idle" | "signing" | "done" | { error: string };

function short(s: string, head = 6, tail = 4) {
  if (!s) return "—";
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function formatAmount(raw: string): string {
  // Best-effort: show short form for very large numbers (max approvals).
  if (!raw || raw === "0") return "0";
  if (/^\d+$/.test(raw) && raw.length > 12) return `${raw.slice(0, 4)}…e${raw.length - 1}`;
  return raw;
}

const RISK_ORDER = { high: 0, medium: 1, safe: 2, safest: 3, unknown: 4 } as const;

export default function ApprovalsPage() {
  const wallet = useWallet();
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokeState, setRevokeState] = useState<Record<string, RevokeState>>({});

  const connection = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    return new Connection(url, "confirmed");
  }, []);

  const load = useCallback(async () => {
    if (!wallet.publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/webacy/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: wallet.publicKey.toBase58(), chain: "sol" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { approvals: ApprovalRow[] };
      const sorted = [...(data.approvals ?? [])].sort(
        (a, b) => RISK_ORDER[a.risk.level] - RISK_ORDER[b.risk.level]
      );
      setRows(sorted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load approvals");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [wallet.publicKey]);

  useEffect(() => {
    if (wallet.connected) void load();
  }, [wallet.connected, load]);

  const highCount = rows?.filter((r) => r.risk.level === "high").length ?? 0;
  const mediumCount = rows?.filter((r) => r.risk.level === "medium").length ?? 0;

  const handleRevoke = useCallback(
    async (row: ApprovalRow) => {
      if (!wallet.publicKey) return;
      const key = `${row.token}:${row.spender}`;
      setRevokeState((s) => ({ ...s, [key]: "signing" }));
      try {
        await revokeApproval({
          wallet,
          connection,
          owner: wallet.publicKey,
          mint: row.token,
        });
        setRevokeState((s) => ({ ...s, [key]: "done" }));
        // Optimistically drop the row after a short delay for feedback.
        setTimeout(() => {
          setRows((prev) => (prev ? prev.filter((r) => !(r.token === row.token && r.spender === row.spender)) : prev));
        }, 800);
      } catch (err) {
        setRevokeState((s) => ({
          ...s,
          [key]: { error: err instanceof Error ? err.message : "Failed to revoke" },
        }));
      }
    },
    [wallet, connection]
  );

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-10 sm:py-14 space-y-8">
        {/* Header */}
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-3 py-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            Token approvals · Powered by Webacy
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Approval sweep</h1>
          <p className="text-slate-600 max-w-2xl">
            Every outstanding delegate on this wallet, scored by Webacy. Revoke anything you don&apos;t
            recognize — one click, signed by your wallet, on-chain immediately.
          </p>
        </header>

        {/* Summary */}
        {rows && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SummaryCard label="Total approvals" value={rows.length} tone="neutral" />
            <SummaryCard label="High risk" value={highCount} tone={highCount > 0 ? "danger" : "neutral"} />
            <SummaryCard label="Caution" value={mediumCount} tone={mediumCount > 0 ? "warn" : "neutral"} />
          </div>
        )}

        {/* Empty / wallet gate */}
        {!wallet.connected && (
          <div className="rounded-3xl border border-violet-200 bg-violet-50/40 px-6 py-10 text-center space-y-3">
            <p className="text-slate-700">Connect a wallet to see its outstanding approvals.</p>
          </div>
        )}

        {/* Toolbar */}
        {wallet.connected && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500 font-mono break-all">{wallet.publicKey?.toBase58()}</p>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:text-violet-900 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>Couldn&apos;t load approvals: {error}</span>
          </div>
        )}

        {/* Table */}
        {wallet.connected && !error && (
          <div className="rounded-3xl border border-violet-100 bg-white overflow-hidden">
            {loading && !rows && (
              <div className="px-6 py-16 text-center text-slate-500 text-sm">Scanning approvals…</div>
            )}

            {rows && rows.length === 0 && !loading && (
              <div className="px-6 py-16 text-center space-y-2">
                <ShieldCheck className="h-8 w-8 text-violet-500 mx-auto" />
                <p className="text-slate-700 font-medium">No outstanding approvals</p>
                <p className="text-slate-500 text-sm">This wallet has no active token delegates.</p>
              </div>
            )}

            {rows && rows.length > 0 && (
              <>
                {/* Desktop */}
                <table className="w-full hidden sm:table">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-violet-100">
                      <th className="px-5 py-3 font-medium">Risk</th>
                      <th className="px-5 py-3 font-medium">Token</th>
                      <th className="px-5 py-3 font-medium">Spender</th>
                      <th className="px-5 py-3 font-medium text-right">Amount</th>
                      <th className="px-5 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const key = `${row.token}:${row.spender}`;
                      const state = revokeState[key] ?? "idle";
                      return (
                        <tr key={key} className="border-b border-violet-50 last:border-0 hover:bg-violet-50/30">
                          <td className="px-5 py-4"><RiskChip score={row.risk} /></td>
                          <td className="px-5 py-4">
                            <div className="font-mono text-xs text-slate-700">{short(row.token, 8, 6)}</div>
                            {row.risk.flags.length > 0 && (
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                {row.risk.flags.slice(0, 2).join(" · ").replace(/_/g, " ")}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <a
                              href={`https://solscan.io/account/${row.spender}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-xs text-slate-700 hover:text-violet-700"
                            >
                              {short(row.spender, 8, 6)}
                              <ExternalLink className="h-3 w-3 opacity-60" />
                            </a>
                          </td>
                          <td className="px-5 py-4 text-right font-mono text-xs text-slate-600">
                            {formatAmount(row.amount)}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <RevokeButton state={state} onClick={() => void handleRevoke(row)} highRisk={row.risk.level === "high"} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Mobile stacked */}
                <ul className="sm:hidden divide-y divide-violet-50">
                  {rows.map((row) => {
                    const key = `${row.token}:${row.spender}`;
                    const state = revokeState[key] ?? "idle";
                    return (
                      <li key={key} className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <RiskChip score={row.risk} />
                          <span className="font-mono text-xs text-slate-500">{formatAmount(row.amount)}</span>
                        </div>
                        <div className="space-y-1 text-xs">
                          <div>
                            <span className="text-slate-500">Token </span>
                            <span className="font-mono text-slate-700 break-all">{row.token}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Spender </span>
                            <span className="font-mono text-slate-700 break-all">{row.spender}</span>
                          </div>
                          {row.risk.flags.length > 0 && (
                            <div className="text-slate-500">{row.risk.flags.slice(0, 3).join(" · ").replace(/_/g, " ")}</div>
                          )}
                        </div>
                        <RevokeButton state={state} onClick={() => void handleRevoke(row)} highRisk={row.risk.level === "high"} full />
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}

        <footer className="text-xs text-slate-400 pt-4 border-t border-violet-100">
          Risk data by <Link href="https://webacy.com" className="underline hover:text-violet-700">Webacy</Link>. Revokes are signed by your wallet and submitted directly on-chain.
        </footer>
      </div>
    </main>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "neutral" | "warn" | "danger" }) {
  const toneCls =
    tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-violet-100 bg-white text-slate-900";
  return (
    <div className={`rounded-3xl border px-5 py-4 ${toneCls}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function RevokeButton({
  state,
  onClick,
  highRisk,
  full = false,
}: {
  state: RevokeState;
  onClick: () => void;
  highRisk: boolean;
  full?: boolean;
}) {
  const width = full ? "w-full" : "";
  if (state === "done") {
    return (
      <span className={`inline-flex items-center justify-center gap-1 rounded-full border border-violet-200 bg-violet-50 text-violet-700 text-xs px-3 py-1.5 ${width}`}>
        <ShieldCheck className="h-3.5 w-3.5" />
        Revoked
      </span>
    );
  }
  if (state === "signing") {
    return (
      <button
        disabled
        className={`inline-flex items-center justify-center gap-1 rounded-full bg-slate-200 text-slate-600 text-xs px-3 py-1.5 ${width}`}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Signing…
      </button>
    );
  }
  if (typeof state === "object") {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={onClick}
          className={`inline-flex items-center justify-center rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium px-3 py-1.5 ${width}`}
        >
          Retry revoke
        </button>
        <span className="text-[10px] text-rose-600 max-w-[220px] text-right">{state.error}</span>
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-full text-xs font-medium px-3 py-1.5 transition-colors ${
        highRisk
          ? "bg-rose-600 hover:bg-rose-700 text-white"
          : "bg-violet-600 hover:bg-violet-700 text-white"
      } ${width}`}
    >
      Revoke
    </button>
  );
}
