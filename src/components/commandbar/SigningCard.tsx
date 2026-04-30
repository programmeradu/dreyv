"use client";

// Feature: commandbar-god-mode
// SigningCard — shown inside a ToolCard when a transaction payload requires wallet approval.
// Phase A restyle: flat light/violet to match analytics + treasury aesthetic.

import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

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

      {/* Sent — show success with signatures */}
      {signingStatus === "sent" && (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Transactions sent
          </p>
          {txSignatures.map((sig, i) => (
            <p key={i} className="font-mono text-[11px] text-slate-500">
              {sig.slice(0, 12)}…
            </p>
          ))}
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
