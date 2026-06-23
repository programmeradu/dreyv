"use client";

/**
 * TransactionInspector — Visual blockchain debugger for dreyv Studio.
 *
 * Displays a visual timeline of transactions executed during the preview session,
 * including impact reports, state diffs, gas estimation, and simulation results.
 *
 * [Phase 8] — Visual Blockchain Debugger
 */

import React, { useState } from "react";
import {
    Activity, ArrowRight, ArrowDown, CheckCircle, AlertTriangle,
    Clock, Hash, Loader2, ChevronDown, ChevronRight, Zap, Shield,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────

export interface TransactionEntry {
    id: string;
    timestamp: number;
    type: "swap" | "transfer" | "sign" | "gasless" | "simulation";
    method: string;
    status: "pending" | "confirmed" | "failed";
    signature?: string;
    details: Record<string, unknown>;
    impact?: {
        before: Record<string, number>;
        after: Record<string, number>;
        diff: { symbol: string; delta: number; percentChange: number }[];
    };
    gasEstimate?: number;
    simulationHash?: string;
}

interface TransactionInspectorProps {
    transactions: TransactionEntry[];
    isOpen: boolean;
    onClose: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getTypeIcon(type: TransactionEntry["type"]) {
    switch (type) {
        case "swap": return <ArrowRight className="w-3.5 h-3.5 text-cyan-600" />;
        case "transfer": return <ArrowDown className="w-3.5 h-3.5 text-blue-600" />;
        case "sign": return <Shield className="w-3.5 h-3.5 text-violet-600" />;
        case "gasless": return <Zap className="w-3.5 h-3.5 text-amber-600" />;
        case "simulation": return <Activity className="w-3.5 h-3.5 text-emerald-600" />;
    }
}

function getStatusBadge(status: TransactionEntry["status"]) {
    switch (status) {
        case "confirmed":
            return (
                <span className="flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <CheckCircle className="w-3 h-3" /> Confirmed
                </span>
            );
        case "failed":
            return (
                <span className="flex items-center gap-1 text-[10px] text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                    <AlertTriangle className="w-3 h-3" /> Failed
                </span>
            );
        case "pending":
            return (
                <span className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                    <Loader2 className="w-3 h-3 animate-spin" /> Pending
                </span>
            );
    }
}

// ─── Component ──────────────────────────────────────────────────────

export function TransactionInspector({
    transactions,
    isOpen,
    onClose,
}: TransactionInspectorProps) {
    const [expandedId, setExpandedId] = useState<string | null>(null);

    if (!isOpen) return null;

    return (
        <div className="h-full bg-white border-l border-violet-100 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-violet-100 bg-slate-50/60">
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-violet-600" />
                    <h3 className="text-sm font-bold text-slate-900">Transaction Inspector</h3>
                    <span className="text-[10px] text-slate-500 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-full">
                        {transactions.length}
                    </span>
                </div>
                <button
                    onClick={onClose}
                    className="text-xs text-slate-500 hover:text-slate-900 transition-colors"
                >
                    Close
                </button>
            </div>

            {/* Transaction List */}
            <div className="flex-1 overflow-auto">
                {transactions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <Activity className="w-8 h-8 mb-3 opacity-40" />
                        <p className="text-xs text-slate-500">No transactions yet</p>
                        <p className="text-[10px] text-slate-400 mt-1">
                            Interact with your Mini-App to see transactions
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {transactions.map((tx) => {
                            const isExpanded = expandedId === tx.id;
                            return (
                                <div key={tx.id} className="group">
                                    {/* Summary Row */}
                                    <button
                                        onClick={() => setExpandedId(isExpanded ? null : tx.id)}
                                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-violet-50/50 transition-colors text-left"
                                    >
                                        <div className="shrink-0">
                                            {isExpanded
                                                ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                                                : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                                            }
                                        </div>
                                        <div className="shrink-0">
                                            {getTypeIcon(tx.type)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-semibold text-slate-800 truncate">
                                                {tx.method}
                                            </p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                                    <Clock className="w-3 h-3" /> {formatTime(tx.timestamp)}
                                                </span>
                                                {tx.signature && (
                                                    <span className="text-[10px] text-slate-500 flex items-center gap-1 truncate max-w-[100px]">
                                                        <Hash className="w-3 h-3" /> {tx.signature.slice(0, 12)}…
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {getStatusBadge(tx.status)}
                                    </button>

                                    {/* Expanded Details */}
                                    {isExpanded && (
                                        <div className="px-4 pb-4 pl-12 space-y-3">
                                            {/* Impact Diff */}
                                            {tx.impact && tx.impact.diff.length > 0 && (
                                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                                                    <h4 className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-2">
                                                        State Diff
                                                    </h4>
                                                    <div className="space-y-1">
                                                        {tx.impact.diff.map((d) => (
                                                            <div key={d.symbol} className="flex items-center justify-between text-xs">
                                                                <span className="text-slate-600">{d.symbol}</span>
                                                                <span className={d.delta >= 0 ? "text-emerald-700" : "text-red-700"}>
                                                                    {d.delta >= 0 ? "+" : ""}{d.delta.toFixed(4)}
                                                                    <span className="text-slate-400 ml-1">
                                                                        ({d.percentChange.toFixed(2)}%)
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Gas Estimate */}
                                            {tx.gasEstimate && (
                                                <div className="flex items-center justify-between text-xs">
                                                    <span className="text-slate-500">Gas Estimate</span>
                                                    <span className="text-slate-800 font-mono">
                                                        {tx.gasEstimate.toLocaleString()} lamports
                                                    </span>
                                                </div>
                                            )}

                                            {/* Simulation Hash */}
                                            {tx.simulationHash && (
                                                <div className="flex items-center justify-between text-xs">
                                                    <span className="text-slate-500">Simulation</span>
                                                    <code className="text-slate-700 font-mono text-[10px]">
                                                        {tx.simulationHash.slice(0, 20)}…
                                                    </code>
                                                </div>
                                            )}

                                            {/* Raw Details */}
                                            <details className="group/raw">
                                                <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-700 transition-colors">
                                                    Raw Params
                                                </summary>
                                                <pre className="mt-1 text-[10px] text-slate-700 font-mono bg-slate-50 border border-slate-200 rounded p-2 overflow-auto max-h-32">
                                                    {JSON.stringify(tx.details, null, 2)}
                                                </pre>
                                            </details>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
