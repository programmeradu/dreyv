"use client";

// Feature: commandbar-god-mode
// SigningCard — shown inside a ToolCard when a transaction payload requires wallet approval.
// Phase A restyle: flat light/violet to match analytics + treasury aesthetic.

import { Loader2, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import { solscanUrl, openExternal } from "@/lib/solana/send-and-confirm";

export interface SigningCardProps {
  toolCallId: string;
  operation: string;
  serializedTransactions: string[];
  signingStatus: "idle" | "signing" | "sent" | "error";
  txSignatures: string[];
  onConfirm: () => void;
}

export function SigningCard({
  operation,
  serializedTransactions,
  signingStatus,
  txSignatures,
  onConfirm,
}: SigningCardProps) {
  const txCount = serializedTransactions.length;
  const txLabel = txCount === 1 ? "1 transaction" : `${txCount} transactions`;

  return (
    <div className="mt-2 rounded-2xl border border-violet-100 bg-violet-50/40 px-3 py-2.5 font-manrope">
      {/* Operation info */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-violet-700">{operation}</span>
        <span className="text-[11px] font-medium text-slate-500">{txLabel}</span>
      </div>

      {/* Idle — show confirm button */}
      {signingStatus === "idle" && (
        <button
          onClick={onConfirm}
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700"
        >
          Confirm &amp; Sign
        </button>
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
        <p className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          Signing failed. Please try again.
        </p>
      )}
    </div>
  );
}
