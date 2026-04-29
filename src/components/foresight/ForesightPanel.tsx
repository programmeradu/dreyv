"use client";

/**
 * ForesightPanel (deterministic IR build)
 * ───────────────────────────────────────
 * Replaces the legacy iframe + Babel + arbitrary TSX path. Now:
 *
 *   prompt → parser → variables → /api/foresight/ir → DashboardIR → renderer
 *
 * Same input → identical UI. Brand-locked (flat, violet, Manrope). No
 * sandboxed runtime, no Tailwind CDN, no Babel — just deterministic JSON
 * → typed React.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Send, X, ChevronDown, History, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useVault } from "@/lib/contexts/VaultContext";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  parseForesightPrompt,
  type PortfolioSnapshot,
} from "@/lib/foresight/foresight-agent";
import { DashboardIRRenderer } from "@/lib/foresight/DashboardIRRenderer";
import type { DashboardIR } from "@/lib/foresight/ir";

// ─── Preset Prompts ─────────────────────────────────────────────────

const PRESET_PROMPTS = [
  "What if SOL drops 50% over 12 months?",
  "Runway with $20k/month burn rate?",
  "SOL drops 30% + $15k/month burn + 8% APY yield",
  "What if ETH rises 100% over 6 months?",
  "Impact of a 500 SOL buyback if price slips 20%",
];

interface HistoryEntry {
  prompt: string;
  ir: DashboardIR;
}

// ─── Component ──────────────────────────────────────────────────────

export function ForesightPanel() {
  const { vaultTokens } = useVault();
  const [prompt, setPrompt] = useState("");
  const [ir, setIR] = useState<DashboardIR | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Build portfolio snapshot from vault context
  const buildPortfolio = (): PortfolioSnapshot[] =>
    vaultTokens.length > 0
      ? vaultTokens.map((t) => ({
          symbol: t.symbol || "SPL",
          amount: t.amount || 0,
          price: t.price || 0,
        }))
      : [
          { symbol: "SOL", amount: 124.5, price: 175.0 },
          { symbol: "USDC", amount: 54000, price: 1.0 },
          { symbol: "JUP", amount: 850, price: 1.12 },
          { symbol: "BONK", amount: 15000000, price: 0.000024 },
        ];

  const generate = useCallback(
    async (input?: string) => {
      const p = (input ?? prompt).trim();
      if (!p) {
        toast.error("Type a What-If scenario to generate a foresight.");
        return;
      }

      const portfolio = buildPortfolio();
      const parsed = parseForesightPrompt(p);

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/foresight/ir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            prompt: p,
            variables: parsed.variables,
            timeframeMonths: parsed.timeframeMonths,
            portfolio,
            confidence: parsed.confidence,
            title: parsed.title,
          }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error || `IR build failed (${res.status})`);
        }
        const next: DashboardIR = await res.json();
        setIR(next);
        setHistory((prev) => [{ prompt: p, ir: next }, ...prev].slice(0, 10));
        setShowPresets(false);
        toast.success("Foresight ready", {
          description: `${parsed.variables.length} drivers · ${next.scenario.timeframeMonths}mo`,
        });
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(err?.message || "Foresight failed");
        toast.error("Foresight failed: " + (err?.message ?? ""));
      } finally {
        setLoading(false);
      }
    },
    [prompt, vaultTokens],
  );

  const handleClear = () => {
    abortRef.current?.abort();
    setIR(null);
    setError(null);
    setPrompt("");
  };

  useEffect(() => {
    inputRef.current?.focus();
    return () => abortRef.current?.abort();
  }, []);

  return (
    <div className="flex h-full flex-col bg-white font-manrope text-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-violet-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-violet-600" />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700">
            Foresight Engine
          </h3>
        </div>
        <div className="flex items-center gap-1">
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowHistory(!showHistory)}
            >
              <History size={12} className="text-slate-500" />
            </Button>
          )}
          {ir && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleClear}
            >
              <X size={12} className="text-slate-500" />
            </Button>
          )}
        </div>
      </div>

      {/* Prompt Input */}
      <div className="border-b border-violet-100 bg-white px-4 py-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              ref={inputRef}
              placeholder='Ask: "What if SOL drops 50%?"'
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") generate();
              }}
              onFocus={() => !ir && setShowPresets(true)}
              className="h-9 border-violet-200 bg-white pr-20 text-xs"
            />
            {!prompt && (
              <button
                onClick={() => setShowPresets(!showPresets)}
                className="absolute right-12 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-violet-700"
              >
                Presets <ChevronDown size={10} className="inline" />
              </button>
            )}
          </div>
          <Button
            onClick={() => generate()}
            size="sm"
            disabled={loading}
            className="h-9 gap-2 bg-violet-600 px-4 text-[10px] font-semibold uppercase tracking-wider text-white hover:bg-violet-700"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {loading ? "Building" : "Generate"}
          </Button>
        </div>

        {/* Preset Prompts */}
        <AnimatePresence>
          {showPresets && !ir && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap gap-1.5 pt-3">
                {PRESET_PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setPrompt(p);
                      generate(p);
                    }}
                    className="rounded-full border border-violet-200 bg-white px-3 py-1.5 text-[10px] font-medium text-slate-600 hover:border-violet-400 hover:text-violet-700"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* History Dropdown */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-violet-100"
          >
            <div className="max-h-[150px] overflow-y-auto bg-violet-50/40 px-4 py-2">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Recent Foresights
                </span>
                <button
                  onClick={() => {
                    setHistory([]);
                    setShowHistory(false);
                  }}
                  className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-rose-600"
                >
                  <Trash2 size={10} /> Clear
                </button>
              </div>
              {history.map((h, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setIR(h.ir);
                    setPrompt(h.prompt);
                    setShowHistory(false);
                  }}
                  className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white"
                >
                  <Sparkles size={10} className="shrink-0 text-violet-600" />
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-semibold text-slate-800">
                      {h.ir.scenario.title}
                    </div>
                    <div className="truncate text-[10px] text-slate-500">
                      {h.ir.scenario.drivers.length} drivers · {h.ir.scenario.timeframeMonths}mo
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* IR Renderer */}
      <div className="flex-1 overflow-y-auto bg-white p-5">
        {loading && !ir && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
            <p className="text-xs uppercase tracking-[0.18em]">Building deterministic foresight…</p>
          </div>
        )}
        {error && !loading && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5">
            <div className="flex items-center gap-2 text-rose-700">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                Foresight error
              </span>
            </div>
            <p className="mt-2 text-sm text-rose-700">{error}</p>
          </div>
        )}
        {ir && !loading && <DashboardIRRenderer ir={ir} />}
        {!ir && !loading && !error && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-violet-200 bg-violet-50">
              <Sparkles size={20} className="text-violet-600" />
            </div>
            <h4 className="font-manrope text-base font-semibold text-slate-800">
              Generative Foresight
            </h4>
            <p className="max-w-xs text-[12px] leading-relaxed text-slate-600">
              Ask any What-If — drivers parse, the simulator runs deterministically,
              and the dashboard is rendered from a typed IR (no arbitrary code).
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      {ir && (
        <div className="flex items-center justify-between border-t border-violet-100 bg-white px-4 py-2">
          <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            <span>{ir.scenario.drivers.length} driver{ir.scenario.drivers.length !== 1 ? "s" : ""}</span>
            <span className="text-slate-300">·</span>
            <span>{ir.scenario.timeframeMonths}mo horizon</span>
            <span className="text-slate-300">·</span>
            <span className="text-violet-700">
              {vaultTokens.length > 0 ? "LIVE VAULT" : "DEMO PORTFOLIO"}
            </span>
          </div>
          {ir.hash && (
            <span className="text-[10px] font-mono text-slate-400">{ir.hash}</span>
          )}
        </div>
      )}
    </div>
  );
}
