"use client";

/**
 * AtlasIntelligenceHero — premium light-themed hero command bar for /atlas.
 *
 * Inspired by the user-provided design: centered title + subtitle, pill-shaped
 * input with sparkle icon, mode selector chip (Test / Plan / Simulate / Execute),
 * and a violet send button. Quick-action chips below prefill the input.
 *
 * Always renders in light mode regardless of the surrounding theme.
 */

import React, { useCallback, useState } from "react";
import { Sparkles, ArrowRight, Loader2, ChevronDown, Beaker, Brain, Activity, Zap, Check } from "lucide-react";
import { toast } from "@/lib/toast-notifications";
import { useAtlasCommand } from "@/hooks/use-atlas-command";

type Mode = "test" | "plan" | "simulate" | "execute";

const MODES: { id: Mode; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "test", label: "Test", icon: <Beaker className="h-3.5 w-3.5" />, hint: "Dry-run the command without touching your wallet" },
  { id: "plan", label: "Plan", icon: <Brain className="h-3.5 w-3.5" />, hint: "Outline the strategy and steps before executing" },
  { id: "simulate", label: "Simulate", icon: <Activity className="h-3.5 w-3.5" />, hint: "Simulate the transaction against current chain state" },
  { id: "execute", label: "Execute", icon: <Zap className="h-3.5 w-3.5" />, hint: "Send the transaction directly for signing" },
];

const QUICK_CHIPS = [
  "Swap 10 SOL to USDC",
  "Trending on DEX",
  "Liquid Staking APY",
  "MEV Activity",
];

/**
 * Light-weight regex fallback so the bar is useful even when the LLM is down.
 * Mirrors the smaller subset used elsewhere; full coverage lives in atlas-shell.
 */
function regexFallbackParse(text: string): { tool_id: string; parameters: Record<string, any> } | null {
  const lower = text.toLowerCase().trim();
  const amtMatch = lower.match(/([0-9]+(?:\.[0-9]+)?)/);
  const amt = amtMatch ? Number(amtMatch[1]) : undefined;

  if (/\b(swap|buy|sell|convert|trade)\b/.test(lower)) {
    const swapMatch = lower.match(/(\d+(?:\.\d+)?)\s*(\w+)\s*(?:to|for|into|→)\s*(\w+)/);
    if (swapMatch) return { tool_id: "swap_tokens", parameters: { amount: Number(swapMatch[1]), input_token: swapMatch[2], output_token: swapMatch[3] } };
    return { tool_id: "swap_tokens", parameters: { amount: amt, input_token: "SOL", output_token: "USDC" } };
  }
  if (/\b(stake|staking)\b/.test(lower)) return { tool_id: "stake_sol", parameters: { amount: amt, provider: "marinade" } };
  if (/\b(trending|dex)\b/.test(lower)) return { tool_id: "market_overview", parameters: {} };
  if (/\bmev\b/.test(lower)) return { tool_id: "scan_mev", parameters: {} };
  if (/\b(liquid staking|apy)\b/.test(lower)) return { tool_id: "navigate_to_tab", parameters: { tab_id: "yield-section" } };
  return null;
}

export function AtlasIntelligenceHero() {
  const { dispatch } = useAtlasCommand();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("plan");
  const [modeOpen, setModeOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const activeMode = MODES.find((m) => m.id === mode)!;

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const value = text.trim();
      if (!value) return;

      setLoading(true);
      try {
        let command: { tool_id: string; parameters: Record<string, any> } | null = null;
        try {
          const res = await fetch("/api/ai/parse-atlas-command", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: value }),
          });
          if (res.ok) {
            const parsed = await res.json();
            if (parsed && parsed.tool_id && parsed.tool_id !== "unknown") command = parsed;
          }
        } catch {}

        if (!command) command = regexFallbackParse(value);

        if (command && command.tool_id) {
          // Mode flags consumed by downstream tool handlers.
          const isStrategizing = mode === "plan" || mode === "simulate" || mode === "test";
          const isDryRun = mode === "test";
          const isSimulate = mode === "simulate";
          const isExecute = mode === "execute";
          command.parameters = {
            ...command.parameters,
            _mode: mode,
            _isStrategizing: isStrategizing,
            _dryRun: isDryRun,
            _simulate: isSimulate,
            _execute: isExecute,
          };
          dispatch(command);
          toast.success(`${activeMode.label}: ${command.tool_id.replace(/_/g, " ")}`);
        } else {
          toast.error("Sorry, I couldn't understand that. Try: 'Swap 10 SOL to USDC' or 'MEV activity'.");
        }
      } catch (err: any) {
        toast.error("Error processing command", { description: err.message });
      } finally {
        setLoading(false);
        setText("");
      }
    },
    [text, mode, dispatch, activeMode.label]
  );

  return (
    <section
      className="atlas-light relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-b from-slate-50 via-white to-violet-50/40 px-6 py-10 sm:px-10 sm:py-14"
      style={{ colorScheme: "light" }}
    >
      {/* Soft radial glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 0%, rgba(139,92,246,0.10) 0%, rgba(255,255,255,0) 70%)",
        }}
      />

      <div className="relative mx-auto flex max-w-3xl flex-col items-center text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Solana Atlas Intelligence
        </h1>
        <p className="mt-2 text-sm text-slate-500 sm:text-base">
          Research findings, market signals, and instant workflows
        </p>

        {/* Pill input */}
        <form onSubmit={handleSubmit} className="mt-6 w-full">
          <div className="group relative flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pl-4 pr-1.5 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.15)] transition-shadow focus-within:shadow-[0_12px_32px_-12px_rgba(124,58,237,0.25)] focus-within:border-violet-300">
            <Sparkles className="h-4 w-4 shrink-0 text-violet-500" aria-hidden />
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ask Atlas… e.g. 'Scan token EPjF…USDC' or 'Find yield opportunities'"
              className="min-w-0 flex-1 bg-transparent py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              disabled={loading}
            />

            {/* Mode selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setModeOpen((v) => !v)}
                onBlur={() => setTimeout(() => setModeOpen(false), 120)}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 transition-colors hover:border-violet-300 hover:text-violet-700"
                aria-haspopup="menu"
                aria-expanded={modeOpen}
                aria-label={`Mode: ${activeMode.label}`}
              >
                {activeMode.icon}
                <span>{activeMode.label}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
              {modeOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+8px)] z-30 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
                >
                  {MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={mode === m.id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setMode(m.id);
                        setModeOpen(false);
                      }}
                      className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                        mode === m.id ? "bg-violet-50 text-violet-900" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span className={`mt-0.5 ${mode === m.id ? "text-violet-600" : "text-slate-500"}`}>{m.icon}</span>
                      <span className="flex-1">
                        <span className="flex items-center justify-between text-sm font-semibold">
                          {m.label}
                          {mode === m.id && <Check className="h-3.5 w-3.5 text-violet-600" />}
                        </span>
                        <span className="block text-[11px] leading-snug text-slate-500">{m.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Send */}
            <button
              type="submit"
              disabled={loading || !text.trim()}
              aria-label="Send command"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white shadow-sm transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        </form>

        {/* Quick chips */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setText(chip)}
              className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[11px] font-medium text-slate-600 backdrop-blur-sm transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
