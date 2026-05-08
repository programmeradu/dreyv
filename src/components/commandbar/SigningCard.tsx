"use client";

// Feature: commandbar-god-mode
// SigningCard — shown inside a ToolCard when a transaction payload requires wallet approval.
// Phase A restyle: flat light/violet to match analytics + treasury aesthetic.

import { Loader2, CheckCircle2, AlertTriangle, ExternalLink, ShieldCheck, ShieldAlert, ShieldX, Layers, Zap } from "lucide-react";
import { solscanUrl, openExternal } from "@/lib/solana/send-and-confirm";

export type SigningRiskLevel = "low" | "medium" | "high" | "critical";
export type SigningBundleStrategy = "sequential" | "atomic";

export interface SigningCardProps {
  toolCallId: string;
  operation: string;
  serializedTransactions: string[];
  signingStatus: "idle" | "signing" | "sent" | "error";
  txSignatures: string[];
  onConfirm: () => void;
  riskLevel?: SigningRiskLevel;
  riskReason?: string;
  /**
   * "sequential" (default): one wallet popup, N independent on-chain landings.
   * "atomic": one wallet popup, N txs submitted as a Jito bundle — all-or-nothing.
   */
  bundleStrategy?: SigningBundleStrategy;
  /** Optional human label used for the atomic badge tooltip. */
  bundleReason?: string;
}

interface RiskMeta {
  label: string;
  dotClass: string;
  textClass: string;
  borderClass: string;
  bgClass: string;
  Icon: typeof ShieldCheck;
  pulse: boolean;
  blocksSigning: boolean;
}

function riskMeta(level: SigningRiskLevel): RiskMeta {
  switch (level) {
    case "low":
      return {
        label: "Low risk",
        dotClass: "bg-emerald-500",
        textClass: "text-emerald-700",
        borderClass: "border-emerald-200",
        bgClass: "bg-emerald-50",
        Icon: ShieldCheck,
        pulse: true,
        blocksSigning: false,
      };
    case "medium":
      return {
        label: "Medium risk",
        dotClass: "bg-amber-500",
        textClass: "text-amber-700",
        borderClass: "border-amber-200",
        bgClass: "bg-amber-50",
        Icon: ShieldAlert,
        pulse: true,
        blocksSigning: false,
      };
    case "high":
      return {
        label: "High risk",
        dotClass: "bg-rose-500",
        textClass: "text-rose-700",
        borderClass: "border-rose-200",
        bgClass: "bg-rose-50",
        Icon: ShieldAlert,
        pulse: true,
        blocksSigning: true,
      };
    case "critical":
      return {
        label: "Blocked",
        dotClass: "bg-rose-600",
        textClass: "text-rose-700",
        borderClass: "border-rose-300",
        bgClass: "bg-rose-50",
        Icon: ShieldX,
        pulse: false,
        blocksSigning: true,
      };
  }
}

export function SigningCard({
  operation,
  serializedTransactions,
  signingStatus,
  txSignatures,
  onConfirm,
  riskLevel,
  riskReason,
  bundleStrategy = "sequential",
  bundleReason,
}: SigningCardProps) {
  const txCount = serializedTransactions.length;
  const txLabel = txCount === 1 ? "1 transaction" : `${txCount} transactions`;
  const meta = riskLevel ? riskMeta(riskLevel) : null;
  const blocked = meta?.blocksSigning ?? false;
  const isAtomic = bundleStrategy === "atomic" && txCount > 1;
  const isMulti = txCount > 1;

  return (
    <div className="mt-2 rounded-2xl border border-violet-100 bg-violet-50/40 px-3 py-2.5 font-manrope">
      {/* Operation info */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-violet-700">{operation}</span>
        <span className="text-[11px] font-medium text-slate-500">{txLabel}</span>
      </div>

      {/* Multi-tx + bundle disclosure */}
      {isMulti && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
          <Layers className="h-3 w-3 text-violet-500" />
          <span>1 wallet popup · {txCount} transactions</span>
          {isAtomic && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700"
              title={bundleReason ?? "Atomic Jito bundle — all-or-nothing"}
            >
              <Zap className="h-2.5 w-2.5" />
              Atomic
            </span>
          )}
        </div>
      )}

      {/* Idle — show confirm button + visible risk badge */}
      {signingStatus === "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onConfirm}
            disabled={blocked}
            className={
              blocked
                ? "cursor-not-allowed rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500"
                : "rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700"
            }
            title={blocked && riskReason ? riskReason : undefined}
          >
            {blocked
              ? "Signing blocked"
              : isMulti
              ? `Confirm & sign ${txCount} txs`
              : "Confirm & Sign"}
          </button>
          {meta && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border ${meta.borderClass} ${meta.bgClass} px-2 py-0.5 text-[11px] font-semibold ${meta.textClass}`}
              title={riskReason ?? meta.label}
            >
              <span className="relative flex h-2 w-2">
                {meta.pulse && (
                  <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${meta.dotClass}`} />
                )}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${meta.dotClass}`} />
              </span>
              <meta.Icon className="h-3 w-3" />
              {meta.label}
            </span>
          )}
        </div>
      )}
      {signingStatus === "idle" && blocked && riskReason && (
        <p className="mt-1.5 text-[11px] leading-snug text-rose-600">{riskReason}</p>
      )}

      {/* Signing — show spinner */}
      {signingStatus === "signing" && (
        <div className="flex items-center gap-2 text-violet-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="text-xs font-medium">Awaiting wallet…</span>
        </div>
      )}

      {/* Sent — show success with signatures + explorer links */}
      {signingStatus === "sent" && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {txSignatures.length === 1 ? "Transaction confirmed" : "Transactions confirmed"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {txSignatures.map((sig, i) => (
              <button
                key={i}
                onClick={() => openExternal(solscanUrl(sig))}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-2.5 py-1 font-mono text-[11px] text-violet-700 transition-colors hover:bg-violet-50"
                title={sig}
              >
                {sig.slice(0, 8)}…{sig.slice(-4)}
                <ExternalLink className="h-3 w-3" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error state */}
      {signingStatus === "error" && (
        <div className="space-y-0.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            Signing failed. Please try again.
          </p>
          {isAtomic && (
            <p className="pl-5 text-[11px] text-slate-500">
              Atomic bundle — no transactions executed. Safe to retry.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
