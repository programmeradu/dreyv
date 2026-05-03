"use client";

// Friendly inline error renderer for tool cards.
//
// What's dynamic now:
//  • Suggestion chips read the original `input` (current slippage bps,
//    amount, threshold, etc.) and propose the *next* sensible step
//    (e.g. current 50 bps → 100 / 200, not a fixed ladder).
//  • Insufficient-funds reads `output.shortfall` / `output.balance` to
//    suggest the exact resizable amount.
//  • Multisig threshold failures suggest threshold-1 if N>1.
//  • Unknown errors fall back to the LLM error-explainer via
//    /api/explain-error and render its `whatToDoNext` as chips.
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
  Loader2,
} from "lucide-react";

interface Suggestion {
  label: string;
  /** If set, dispatched as an AGENT_COMMAND prefill. */
  prompt?: string;
}

interface Props {
  rawMessage: string;
  toolName?: string;
  operation?: string;
  /** Original input the failing tool was called with (slippage, amount…). */
  input?: Record<string, unknown>;
  /** Failing output payload — may carry shortfall/balance/threshold hints. */
  output?: Record<string, unknown>;
  /** Pre-fill the command bar with a suggested follow-up. */
  onSuggest?: (prompt: string) => void;
}

type Category =
  | "slippage"
  | "configuration"
  | "firewall"
  | "insufficient_funds"
  | "rejected"
  | "liquidity"
  | "network"
  | "not_found"
  | "rpc"
  | "multisig_threshold"
  | "unknown";

interface Diagnosis {
  category: Category;
  title: string;
  explanation: string;
  suggestions: Suggestion[];
  icon: React.ReactNode;
  tone: "amber" | "rose" | "violet" | "slate";
}

// ── helpers ──────────────────────────────────────────────────────────────

function asNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function fmtAmt(n: number): string {
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

// ── classifier (context-aware) ───────────────────────────────────────────

function classify(
  raw: string,
  op?: string,
  input?: Record<string, unknown>,
  output?: Record<string, unknown>,
): Diagnosis {
  const m = raw.toLowerCase();

  // ── Missing server/provider configuration — common for read-only intel tools ──
  if (
    m.includes("api_key not configured") ||
    m.includes("server missing") ||
    m.includes("not configured") ||
    m.includes("missing helius") ||
    m.includes("missing api key")
  ) {
    const capability = (op ?? "this capability").replaceAll("_", " ");
    return {
      category: "configuration",
      title: "Data provider is not configured",
      explanation: `Dreyv tried to run ${capability}, but the server is missing the required data-provider key. No transaction was created and no wallet action is needed.`,
      suggestions: [
        { label: "Try a price-only check", prompt: "Run a price-only check instead" },
        { label: "Skip sentiment for now" },
      ],
      icon: <AlertTriangle className="h-4 w-4" />,
      tone: "violet",
    };
  }

  // ── Slippage — dynamic ladder based on current setting ────────────────
  if (m.includes("slippage") || m.includes("slippageguard")) {
    const currentBps =
      asNum(input?.slippageBps) ??
      asNum(output?.slippageBps) ??
      (asNum(input?.slippage) !== undefined ? Math.round((asNum(input?.slippage) ?? 0) * 100) : undefined);

    // Build a ladder: 2× and 4× current (capped), or sensible defaults.
    const next1 = currentBps ? Math.min(1000, Math.max(currentBps * 2, currentBps + 50)) : 100;
    const next2 = currentBps ? Math.min(1000, Math.max(currentBps * 4, currentBps + 150)) : 200;

    const fmt = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
    const verb = op === "execute_swap" || op === "swap" ? "Swap" : "Retry";

    const explanation = currentBps
      ? `Current tolerance is ${fmt(currentBps)} but the price moved further between quote and execution. The simulation refused the trade so you don't get a worse fill.`
      : "The market shifted between quote and execution, so the simulation refused the trade to protect you from a bad fill.";

    return {
      category: "slippage",
      title: "Price moved past your slippage tolerance",
      explanation,
      suggestions: [
        { label: `${verb} with ${fmt(next1)} slippage`, prompt: `${verb} with ${fmt(next1)} slippage` },
        { label: `${verb} with ${fmt(next2)} slippage`, prompt: `${verb} with ${fmt(next2)} slippage` },
        { label: "Wait & try again" },
      ],
      icon: <ShieldAlert className="h-4 w-4" />,
      tone: "amber",
    };
  }

  // ── Multisig threshold ────────────────────────────────────────────────
  if (m.includes("threshold") && (m.includes("multisig") || m.includes("members"))) {
    const threshold = asNum(input?.threshold) ?? asNum(output?.threshold);
    const members = asNum(input?.members) ?? asNum(output?.memberCount);
    const sugg: Suggestion[] = [];
    if (threshold && threshold > 1) {
      sugg.push({
        label: `Lower threshold to ${threshold - 1}`,
        prompt: `Create the multisig with threshold ${threshold - 1}${members ? ` of ${members}` : ""}`,
      });
    }
    sugg.push({ label: "Add another member", prompt: "Add another member to the multisig" });
    return {
      category: "multisig_threshold",
      title: "Multisig threshold can't be met",
      explanation:
        threshold && members
          ? `Threshold ${threshold} of ${members} can't be satisfied right now — either lower the threshold or add more members.`
          : "The multisig configuration is internally inconsistent.",
      suggestions: sugg,
      icon: <ShieldAlert className="h-4 w-4" />,
      tone: "amber",
    };
  }

  // ── Firewall (non-slippage guard) ─────────────────────────────────────
  if (m.includes("simulation firewall") || m.includes("firewall blocked")) {
    return {
      category: "firewall",
      title: "Simulation Firewall blocked this transaction",
      explanation:
        "Dreyv simulated the transaction before signing and detected a guard violation. Nothing was sent on-chain — your funds are safe.",
      suggestions: [
        { label: "Show firewall reason", prompt: "Why did the firewall block that?" },
        { label: "Retry with relaxed guards", prompt: "Retry once with relaxed guards" },
      ],
      icon: <ShieldAlert className="h-4 w-4" />,
      tone: "amber",
    };
  }

  // ── Insufficient funds — compute resizable amount ─────────────────────
  if (m.includes("insufficient") && (m.includes("sol") || m.includes("balance") || m.includes("lamports") || m.includes("funds"))) {
    const requested = asNum(input?.amount) ?? asNum(output?.amount);
    const balance = asNum(output?.balance) ?? asNum(output?.available);
    const shortfall = asNum(output?.shortfall);
    const token = (input?.token ?? input?.symbol ?? output?.token ?? "tokens") as string;

    const sugg: Suggestion[] = [];
    if (balance !== undefined) {
      // suggest 95% of available to leave gas
      const safe = Math.max(0, balance * 0.95);
      sugg.push({
        label: `Send ${fmtAmt(safe)} ${token.toUpperCase()} instead`,
        prompt: `Retry with ${fmtAmt(safe)} ${token.toUpperCase()}`,
      });
    } else if (requested !== undefined) {
      sugg.push({
        label: `Try ${fmtAmt(requested / 2)} ${token.toUpperCase()}`,
        prompt: `Retry with ${fmtAmt(requested / 2)} ${token.toUpperCase()}`,
      });
    }
    sugg.push({ label: "Show my balances", prompt: "Show my balances" });

    const explanation =
      shortfall !== undefined
        ? `You're short by ~${fmtAmt(shortfall)} ${token.toUpperCase()} (including network fees).`
        : balance !== undefined && requested !== undefined
          ? `Requested ${fmtAmt(requested)} but only ${fmtAmt(balance)} ${token.toUpperCase()} available.`
          : "Your wallet doesn't have enough to cover the operation plus network fees.";

    return {
      category: "insufficient_funds",
      title: "Not enough balance to cover this",
      explanation,
      suggestions: sugg,
      icon: <Wallet className="h-4 w-4" />,
      tone: "rose",
    };
  }

  if (m.includes("rejected") || m.includes("user denied") || m.includes("user rejected")) {
    return {
      category: "rejected",
      title: "You rejected the request in your wallet",
      explanation: "No transaction was sent and no funds moved. You can re-run the command whenever you're ready.",
      suggestions: [{ label: "Try again" }],
      icon: <Ban className="h-4 w-4" />,
      tone: "slate",
    };
  }

  if (m.includes("liquidity") || m.includes("no route")) {
    const requested = asNum(input?.amount);
    const token = (input?.inputToken ?? input?.token ?? "the token") as string;
    const sugg: Suggestion[] = [];
    if (requested !== undefined) {
      sugg.push({
        label: `Try half (${fmtAmt(requested / 2)} ${token.toUpperCase()})`,
        prompt: `Retry with ${fmtAmt(requested / 2)} ${token.toUpperCase()}`,
      });
      sugg.push({
        label: `Split into 4 legs`,
        prompt: `Split this trade into 4 equal legs`,
      });
    } else {
      sugg.push({ label: "Try smaller size", prompt: "Retry with half the amount" });
    }
    sugg.push({ label: "Suggest alt route", prompt: "Suggest an alternative route" });
    return {
      category: "liquidity",
      title: "Not enough liquidity for this trade",
      explanation:
        "The route couldn't fill your size without excessive impact. Smaller trades, or splitting into multiple legs, usually work.",
      suggestions: sugg,
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
        { label: "Retry" },
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
      suggestions: [{ label: "Re-quote and retry" }],
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
      "Asking the model for a friendly explanation and next steps…",
    suggestions: [{ label: "Retry" }],
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

export function ToolError({ rawMessage, operation, toolName, input, output, onSuggest }: Props) {
  const [showRaw, setShowRaw] = React.useState(false);
  const baseDx = React.useMemo(
    () => classify(rawMessage, operation ?? toolName, input, output),
    [rawMessage, operation, toolName, input, output],
  );

  // LLM fallback for unknown errors — fetch friendly explanation + actions.
  const [llm, setLlm] = React.useState<{
    title: string;
    explanation: string;
    suggestions: Suggestion[];
  } | null>(null);
  const [llmLoading, setLlmLoading] = React.useState(false);

  React.useEffect(() => {
    if (baseDx.category !== "unknown") return;
    let cancelled = false;
    setLlmLoading(true);
    fetch("/api/explain-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: rawMessage,
        code: operation ?? toolName,
        context: { input, output },
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const next: Suggestion[] = Array.isArray(data.whatToDoNext)
          ? (data.whatToDoNext as string[]).slice(0, 3).map((s) => ({ label: s, prompt: s }))
          : [];
        setLlm({
          title: typeof data.friendlyMessage === "string" ? data.friendlyMessage : baseDx.title,
          explanation:
            typeof data.whyItHappened === "string"
              ? data.whyItHappened
              : typeof data.whatWentWrong === "string"
                ? data.whatWentWrong
                : baseDx.explanation,
          suggestions: next.length > 0 ? next : baseDx.suggestions,
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLlmLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [baseDx, rawMessage, operation, toolName, input, output]);

  const dx: Diagnosis = llm
    ? { ...baseDx, title: llm.title, explanation: llm.explanation, suggestions: llm.suggestions }
    : baseDx;
  const tone = TONE[dx.tone];

  return (
    <div className={`mt-2 rounded-2xl border ${tone.border} ${tone.bg} px-3 py-2.5`}>
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 ${tone.icon}`}>{dx.icon}</span>
        <div className="min-w-0 flex-1">
          <div className={`flex items-center gap-1.5 text-[12.5px] font-semibold leading-tight ${tone.title}`}>
            {dx.title}
            {llmLoading && baseDx.category === "unknown" && (
              <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
            )}
          </div>
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
            <ChevronDown className={`h-3 w-3 transition-transform ${showRaw ? "rotate-180" : ""}`} />
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
