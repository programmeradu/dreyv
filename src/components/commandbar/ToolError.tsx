"use client";

// Friendly inline error renderer for tool cards.
// Replaces the raw "Simulation Firewall blocked: slippageGuard failed; …"
// dump with: category icon + plain-English title + what to try, plus a
// collapsible "Technical details" for the raw message.
//
// Flat light/violet only (no shadows, no gradients).

import React from "react";
import {
  AlertTriangle,
  ShieldAlert,
  Wallet,
  Wifi,
  Ban,
  Droplets,
  Hash,
  Clock,
  ChevronDown,
  RefreshCw,
} from "lucide-react";

interface Props {
  rawMessage: string;
  toolName?: string;
  operation?: string;
  /** Optional retry hint chips that the parent can wire to a re-issue. */
  onSuggest?: (prompt: string) => void;
}

type Category =
  | "slippage"
  | "firewall"
  | "insufficient_funds"
  | "rejected"
  | "liquidity"
  | "network"
  | "not_found"
  | "rpc"
  | "unknown";

interface Diagnosis {
  category: Category;
  title: string;
  explanation: string;
  suggestions: Array<{ label: string; prompt?: string }>;
  icon: React.ReactNode;
  tone: "amber" | "rose" | "violet" | "slate";
}

function classify(raw: string, op?: string): Diagnosis {
  const m = raw.toLowerCase();

  if (m.includes("slippage") || m.includes("slippageguard")) {
    return {
      category: "slippage",
      title: "Price moved past your slippage tolerance",
      explanation:
        "The market shifted between quote and execution, so the simulation refused the trade to protect you from a bad fill.",
      suggestions: [
        { label: "Retry with 1% slippage", prompt: `${op === "execute_swap" ? "Swap" : "Retry"} with 1% slippage` },
        { label: "Retry with 2% slippage", prompt: `Retry with 2% slippage` },
        { label: "Wait & try again", prompt: undefined },
      ],
      icon: <ShieldAlert className="h-4 w-4" />,
      tone: "amber",
    };
  }

  if (m.includes("simulation firewall") || m.includes("firewall blocked")) {
    return {
      category: "firewall",
      title: "Simulation Firewall blocked this transaction",
      explanation:
        "Dreyv simulated the transaction before signing and detected a guard violation. Nothing was sent on-chain — your funds are safe.",
      suggestions: [
        { label: "Show firewall reason", prompt: "Why did the firewall block that?" },
        { label: "Loosen guards once", prompt: "Retry with relaxed guards" },
      ],
      icon: <ShieldAlert className="h-4 w-4" />,
      tone: "amber",
    };
  }

  if (m.includes("insufficient") && (m.includes("sol") || m.includes("balance") || m.includes("lamports"))) {
    return {
      category: "insufficient_funds",
      title: "Not enough balance to cover this",
      explanation:
        "Your wallet doesn't have enough funds (or SOL for fees) to complete the operation.",
      suggestions: [
        { label: "Check balances", prompt: "Show my balances" },
        { label: "Reduce amount", prompt: "Try again with a smaller amount" },
      ],
      icon: <Wallet className="h-4 w-4" />,
      tone: "rose",
    };
  }

  if (m.includes("rejected") || m.includes("user denied") || m.includes("user rejected")) {
    return {
      category: "rejected",
      title: "You rejected the request in your wallet",
      explanation: "No transaction was sent and no funds moved. You can re-run the command whenever you're ready.",
      suggestions: [{ label: "Try again", prompt: undefined }],
      icon: <Ban className="h-4 w-4" />,
      tone: "slate",
    };
  }

  if (m.includes("liquidity") || m.includes("no route")) {
    return {
      category: "liquidity",
      title: "Not enough liquidity for this trade",
      explanation:
        "The route couldn't fill your size without excessive impact. Smaller trades, or splitting into multiple legs, usually work.",
      suggestions: [
        { label: "Try half the size", prompt: "Retry with half the amount" },
        { label: "Use a different pair", prompt: "Suggest an alternative route" },
      ],
      icon: <Droplets className="h-4 w-4" />,
      tone: "amber",
    };
  }

  if (m.includes("timeout") || m.includes("timed out") || m.includes("network")) {
    return {
      category: "network",
      title: "Network took too long to respond",
      explanation:
        "The RPC didn't reply in time. Your transaction may still land — give it a moment, then re-check before retrying.",
      suggestions: [
        { label: "Re-check status", prompt: "Did my last transaction land?" },
        { label: "Retry", prompt: undefined },
      ],
      icon: <Wifi className="h-4 w-4" />,
      tone: "slate",
    };
  }

  if (m.includes("blockhash") || m.includes("expired") || m.includes("rpc")) {
    return {
      category: "rpc",
      title: "Blockhash expired before signing",
      explanation:
        "The quote's freshness window closed. This usually just means a re-quote is needed — try again right away.",
      suggestions: [{ label: "Re-quote and retry", prompt: undefined }],
      icon: <Clock className="h-4 w-4" />,
      tone: "violet",
    };
  }

  if (m.includes("not found") || m.includes("invalid mint") || m.includes("unknown token")) {
    return {
      category: "not_found",
      title: "Token or account couldn't be found",
      explanation:
        "Double-check the symbol or address. It may not exist on Solana, or the token list hasn't picked it up yet.",
      suggestions: [{ label: "Search token", prompt: "Find token by symbol" }],
      icon: <Hash className="h-4 w-4" />,
      tone: "slate",
    };
  }

  return {
    category: "unknown",
    title: "Something went wrong",
    explanation:
      "The tool returned an error we don't have a friendly mapping for yet. The raw message is below — you can retry or rephrase the command.",
    suggestions: [{ label: "Retry", prompt: undefined }],
    icon: <AlertTriangle className="h-4 w-4" />,
    tone: "rose",
  };
}

const TONE: Record<Diagnosis["tone"], { border: string; bg: string; icon: string; title: string }> = {
  amber: { border: "border-amber-200", bg: "bg-amber-50", icon: "text-amber-600", title: "text-amber-900" },
  rose: { border: "border-rose-200", bg: "bg-rose-50", icon: "text-rose-600", title: "text-rose-900" },
  violet: { border: "border-violet-200", bg: "bg-violet-50", icon: "text-violet-700", title: "text-violet-900" },
  slate: { border: "border-slate-200", bg: "bg-slate-50", icon: "text-slate-600", title: "text-slate-900" },
};

export function ToolError({ rawMessage, operation, toolName, onSuggest }: Props) {
  const [showRaw, setShowRaw] = React.useState(false);
  const dx = React.useMemo(() => classify(rawMessage, operation ?? toolName), [rawMessage, operation, toolName]);
  const tone = TONE[dx.tone];

  return (
    <div className={`mt-2 rounded-2xl border ${tone.border} ${tone.bg} px-3 py-2.5`}>
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 ${tone.icon}`}>{dx.icon}</span>
        <div className="min-w-0 flex-1">
          <div className={`text-[12.5px] font-semibold leading-tight ${tone.title}`}>{dx.title}</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-700">{dx.explanation}</p>

          {dx.suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {dx.suggestions.map((s, i) =>
                s.prompt ? (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onSuggest?.(s.prompt!)}
                    className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-white px-2 py-1 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-50"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {s.label}
                  </button>
                ) : (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600"
                  >
                    {s.label}
                  </span>
                ),
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="mt-2 inline-flex items-center gap-0.5 text-[10.5px] font-medium text-slate-500 hover:text-slate-700"
          >
            <ChevronDown
              className={`h-3 w-3 transition-transform ${showRaw ? "rotate-180" : ""}`}
            />
            {showRaw ? "Hide technical details" : "Technical details"}
          </button>
          {showRaw && (
            <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-slate-200 bg-white px-2 py-1.5 font-mono text-[10.5px] leading-snug text-slate-600 whitespace-pre-wrap break-all">
              {rawMessage}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
