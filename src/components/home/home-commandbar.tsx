"use client";

/**
 * HomeCommandbar — the live, interactive demo on the public landing page.
 *
 * Visitors type a command (or click a chip). We:
 *   1. POST to /api/home/parse → LLM intent → { tool_id, parameters }
 *   2. POST to /api/home/execute → runs the simulation-only equivalent against
 *      the same Solana infrastructure used in-product (Jupiter quotes, MEV
 *      scan, rug check, yield registry, etc.) and returns a structured result.
 *   3. Render a result card matched to result_type.
 *
 * Conversion is SOFT: free unlimited simulation, sign-in only gated on
 * destructive intents (execute, save, deploy, scan-my-wallet).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { ArrowRight, Loader2, AlertTriangle, CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { marketingPrimaryCtaSm } from "./marketing-styles";

type Metric = { label: string; value: string; tone?: "good" | "warn" };
type Action = { label: string; requires_auth?: boolean; intent: string; url?: string };
type Result = {
  result_type: string;
  title: string;
  summary: string;
  metrics?: Metric[];
  items?: any[];
  legs?: any[];
  steps?: string[];
  flags?: { type?: string; message: string; severity?: string }[];
  primary_action?: Action;
  secondary_action?: Action;
  meta?: { source?: string };
};

const EXAMPLES = [
  "Swap 500 SOL to USDC via Jupiter",
  "Rebalance to 60% SOL, 30% USDC, 10% JTO",
  "Stake 100 SOL on Marinade",
  "What if SOL drops 40%?",
  "Audit BONK",
  "Find arbitrage opportunities",
  "Build a DCA bot: 100 USDC into SOL weekly",
  "Find airdrops on my wallet",
  "Build a trading agent",
];

export function HomeCommandbar() {
  const sectionRef = useRef<HTMLElement>(null);
  const inView = useInView(sectionRef, { once: true, margin: "-80px" });

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [parsedTool, setParsedTool] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [runs, setRuns] = useState(0);
  const [authIntent, setAuthIntent] = useState<Action | null>(null);

  /**
   * Safely read a fetch response as JSON. If the server returned plain-text
   * (e.g. Vercel's "Internal Server Error" on a function timeout) we wrap it
   * into a structured `{ error }` object instead of throwing the cryptic
   * `Unexpected token 'I'` JSON parse error at the user.
   */
  async function safeJson(res: Response): Promise<any> {
    const text = await res.text();
    try { return JSON.parse(text); }
    catch {
      return { _nonJson: true, status: res.status, body: text.slice(0, 200) };
    }
  }

  async function run(text: string) {
    const cmd = text.trim();
    if (!cmd) return;
    setInput(cmd);
    setLoading(true);
    setResult(null);
    setParsedTool(null);
    setAuthIntent(null);
    try {
      const pr = await fetch("/api/home/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cmd }),
      });
      const parsed = await safeJson(pr);
      if (parsed?._nonJson || !parsed?.tool_id) {
        throw new Error(parsed?.body || `Parse failed (${pr.status})`);
      }
      setParsedTool(parsed.tool_id);

      const er = await fetch("/api/home/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool_id: parsed.tool_id, parameters: parsed.parameters }),
      });
      const j = await safeJson(er);
      if (j?._nonJson) {
        throw new Error(j.body || `Simulator timed out (${er.status}). Please retry.`);
      }
      setResult(j.result);
      setRuns((r) => r + 1);
    } catch (e: any) {
      setResult({
        result_type: "error",
        title: "Simulator unavailable",
        summary: e?.message || "Please retry in a moment.",
      });
    } finally {
      setLoading(false);
    }
  }

  /**
   * Bypass the parser and execute a tool directly. Used after a `clarify`
   * round-trip where the user supplied missing context (wallet address, SOL
   * amount, demo basket) and we want to feed it straight into the simulator.
   */
  async function executeDirect(tool_id: string, parameters: Record<string, any>, displayLabel: string) {
    setInput(displayLabel);
    setLoading(true);
    setResult(null);
    setParsedTool(tool_id);
    setAuthIntent(null);
    try {
      const er = await fetch("/api/home/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool_id, parameters }),
      });
      const j = await safeJson(er);
      if (j?._nonJson) {
        throw new Error(j.body || `Simulator timed out (${er.status}). Please retry.`);
      }
      setResult(j.result);
      setRuns((r) => r + 1);
    } catch (e: any) {
      setResult({
        result_type: "error",
        title: "Simulator unavailable",
        summary: e?.message || "Please retry in a moment.",
      });
    } finally {
      setLoading(false);
    }
  }

  /**
   * Handle a clarify chip click. Each chip can carry an `action`:
   *  - connect_wallet → open auth gate (treats as soft conversion)
   *  - enter_address  → prompt for a Solana address
   *  - enter_sol      → prompt for SOL amount
   *  - enter_usd      → prompt for USD amount
   *  - use_demo       → re-run with explicit demo opt-in
   *  - (no action)    → fall back to appending the chip text to the original command
   *
   * The follow-up call always re-executes `forTool` directly, merging any
   * server-supplied `extras` (targets, tokens, scenario, etc.) so the original
   * intent survives the round-trip.
   */
  function handleClarifyChip(item: any, originalScenario: string, forTool: string, extras: Record<string, any>) {
    const action = item?.action as string | undefined;
    const base = { scenario: originalScenario, ...extras };
    const label = (suffix: string) => `${originalScenario || forTool} · ${suffix}`;

    if (action === "connect_wallet") {
      setAuthIntent({ label: "Connect wallet", requires_auth: true, intent: "open_app" });
      return;
    }
    if (action === "enter_address") {
      const addr = window.prompt("Paste your Solana wallet address:");
      if (!addr) return;
      executeDirect(forTool, { ...base, portfolio_context: { mode: "wallet", value: addr.trim() } }, label(`wallet ${addr.slice(0, 4)}…${addr.slice(-4)}`));
      return;
    }
    if (action === "enter_sol") {
      const raw = window.prompt("How much SOL? (number only)");
      const amt = Number(raw);
      if (!raw || !isFinite(amt) || amt <= 0) return;
      executeDirect(forTool, { ...base, portfolio_context: { mode: "sol_amount", value: amt }, amount: amt }, label(`${amt} SOL`));
      return;
    }
    if (action === "enter_usd") {
      const raw = window.prompt("Enter USD amount (number only):");
      const amt = Number(raw);
      if (!raw || !isFinite(amt) || amt <= 0) return;
      executeDirect(forTool, { ...base, portfolio_context: { mode: "usd_amount", value: amt } }, label(`$${amt.toLocaleString()}`));
      return;
    }
    if (action === "use_demo") {
      const demoValue = item?.demo_value;
      executeDirect(forTool, { ...base, portfolio_context: { mode: "demo", value: demoValue } }, label("demo basket"));
      return;
    }
    if (action === "apply_param") {
      // Server-suggested chip carries a `params` object that fills the missing field directly.
      const params = (item?.params && typeof item.params === "object") ? item.params : {};
      const summary = Object.entries(params)
        .map(([k, v]) => (typeof v === "object" ? `${k}=${JSON.stringify(v)}` : `${k}=${v}`))
        .join(" ");
      executeDirect(forTool, { ...base, ...params }, label(summary || (item?.symbol ?? "")));
      return;
    }
    const reply = item?.reply || item?.symbol || "";
    if (reply) run(`${input} ${reply}`.trim());
  }


  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    run(input);
  }

  function triggerAction(a: Action) {
    if (a.requires_auth) {
      setAuthIntent(a);
    } else if (a.url) {
      window.location.href = a.url;
    } else {
      window.location.href = "/app";
    }
  }

  return (
    <section
      id="demo"
      ref={sectionRef}
      className="relative border-t border-violet-200/35 scroll-mt-24"
      aria-labelledby="demo-heading"
    >
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-24 md:py-32">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="max-w-3xl mx-auto mb-10 text-center"
        >
          <p className="text-[11px] font-mono uppercase tracking-[0.3em] text-slate-400 mb-5">
            Live · No wallet required
          </p>
          <h2 id="demo-heading" className="text-3xl md:text-5xl font-bold text-slate-900 tracking-[-0.02em]">
            Command the treasury
          </h2>
          <p className="mt-4 text-base text-slate-500 max-w-2xl mx-auto leading-relaxed">
            Type any intent. We run the same Jupiter quotes, MEV scans, and audits the product uses —
            simulation-only, so you see the full plan before you ever sign.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="max-w-3xl mx-auto"
        >
          {/* Command bar */}
          <form
            onSubmit={handleSubmit}
            toolname="dreyv-command"
            tooldescription="Submit a natural-language treasury intent (e.g. 'swap 10 SOL to USDC'). Dreyv plans, simulates, and returns a step preview."
            toolautosubmit="false"
            className="relative rounded-2xl bg-white ring-1 ring-slate-200/80 shadow-[0_20px_60px_-15px_rgba(124,58,237,0.18)]"
          >
            <div className="flex items-center gap-3 px-4 py-3.5">
              <DreyvStar size={18} className="text-violet-600 shrink-0" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                name="intent"
                toolparamdescription="Natural-language treasury intent; one action per line."
                placeholder="Try: Swap 10 SOL to USDC"
                className="flex-1 bg-transparent text-[15px] text-slate-900 placeholder:text-slate-400 outline-none font-medium"
                aria-label="Command input"
                autoComplete="off"
                spellCheck={false}
                disabled={loading}
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white hover:bg-violet-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Run command"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              </button>
            </div>

            {/* Example chips */}
            <div className="border-t border-slate-100 px-3 py-2.5 flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => run(ex)}
                  disabled={loading}
                  className="text-[11.5px] px-2.5 py-1 rounded-md text-slate-500 hover:text-violet-700 hover:bg-violet-50 transition-colors disabled:opacity-50"
                >
                  {ex}
                </button>
              ))}
            </div>
          </form>

          {/* Status line */}
          <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3 text-violet-500" />
              Simulation only · zero wallet risk
            </span>
            {parsedTool && !loading && (
              <span>
                intent: <span className="text-violet-600">{parsedTool}</span>
              </span>
            )}
          </div>

          {/* Result */}
          <AnimatePresence mode="wait">
            {(loading || result) && (
              <motion.div
                key={result?.title || "loading"}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35 }}
                className="mt-6"
              >
                {loading ? (
                  <LoadingCard />
                ) : result ? (
                  <ResultCard
                    result={result}
                    onAction={triggerAction}
                    onClarify={(item) =>
                      handleClarifyChip(
                        item,
                        (result as any)?.scenario || "",
                        (result as any)?.for_tool || "what_if",
                        (result as any)?.extras || {}
                      )
                    }
                  />
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Soft conversion: appears progressively */}
          {runs >= 3 && !authIntent && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-6 flex items-center justify-center gap-3 text-sm text-slate-500"
            >
              <DreyvStar size={14} className="text-violet-500" />
              You've simulated {runs} commands. Ready to run them for real?
              <a href="/app" className="text-violet-700 font-semibold hover:text-violet-900">
                Open Dreyv →
              </a>
            </motion.div>
          )}
        </motion.div>
      </div>

      {/* Auth intent modal */}
      <AnimatePresence>
        {authIntent && <AuthGate intent={authIntent} onClose={() => setAuthIntent(null)} />}
      </AnimatePresence>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function LoadingCard() {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200/80 p-6">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-slate-400">
        <Loader2 className="h-3 w-3 animate-spin text-violet-600" />
        Parsing intent · running simulation
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-3 w-1/2 rounded bg-slate-100 animate-pulse" />
        <div className="h-3 w-3/4 rounded bg-slate-100 animate-pulse" />
        <div className="h-3 w-2/3 rounded bg-slate-100 animate-pulse" />
      </div>
    </div>
  );
}

function ResultCard({
  result,
  onAction,
  onClarify,
}: {
  result: Result;
  onAction: (a: Action) => void;
  onClarify: (item: any) => void;
}) {
  const isClarify = result.result_type === "clarify";
  const accent = result.result_type === "error" ? "rose" : "violet";
  const labelText = result.result_type === "error" ? "Error" : isClarify ? "Follow-up" : "Simulation result";
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200/80 shadow-[0_20px_60px_-15px_rgba(124,58,237,0.18)] overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
        <div>
          <p className={`text-[10px] font-mono uppercase tracking-[0.28em] text-${accent}-600 mb-1`}>
            {labelText}
          </p>
          <h3 className="text-base font-semibold text-slate-900">{result.title}</h3>
          <p className="mt-0.5 text-sm text-slate-600">{result.summary}</p>
        </div>
        {result.result_type !== "error" && !isClarify && <CheckCircle2 className="h-5 w-5 text-violet-500 shrink-0 mt-0.5" />}
        {isClarify && <DreyvStar size={18} className="text-violet-500 shrink-0 mt-0.5" />}
      </div>

      {isClarify && result.items && result.items.length > 0 && (
        <div className="px-5 py-4 flex flex-wrap gap-2">
          {result.items.map((it: any, i: number) => (
            <button
              key={i}
              onClick={() => onClarify(it)}
              className="text-xs font-medium px-3 py-1.5 rounded-full bg-violet-50 text-violet-700 hover:bg-violet-100 ring-1 ring-violet-200/70 transition-colors"
            >
              {it.symbol}
            </button>
          ))}
        </div>
      )}

      <div className="px-5 py-4 space-y-4">
        {result.metrics && result.metrics.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {result.metrics.map((m, i) => (
              <div key={i} className="rounded-lg bg-slate-50 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{m.label}</div>
                <div
                  className={`mt-0.5 text-sm font-semibold ${
                    m.tone === "warn" ? "text-amber-600" : m.tone === "good" ? "text-emerald-600" : "text-slate-900"
                  }`}
                >
                  {m.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {result.legs && result.legs.length > 0 && (
          <div className="rounded-lg border border-slate-100 overflow-hidden">
            <div className="grid grid-cols-4 px-3 py-2 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-medium">
              <span>From</span>
              <span>To</span>
              <span>Amount in</span>
              <span className="text-right">Impact</span>
            </div>
            {result.legs.map((l: any, i: number) => (
              <div key={i} className="grid grid-cols-4 px-3 py-2 text-xs text-slate-700 border-t border-slate-100">
                <span>{l.from}</span>
                <span className="font-medium">{l.to}</span>
                <span>{l.amount_in}</span>
                <span className="text-right text-slate-500">{l.impact}</span>
              </div>
            ))}
          </div>
        )}

        {result.items && result.items.length > 0 && (
          <div className="space-y-2">
            {result.items.map((it: any, i: number) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  {it.icon && <img src={it.icon} alt="" className="h-4 w-4 rounded-full" />}
                  <span className="font-medium text-slate-900">{it.symbol || it.token || it.project}</span>
                  <span className="text-slate-500">{it.name || it.dex || it.criteria}</span>
                </div>
                <span className="text-slate-600 font-mono">{it.profit || it.status || ""}</span>
              </div>
            ))}
          </div>
        )}

        {result.steps && (
          <ol className="space-y-2">
            {result.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
                <span>{s}</span>
              </li>
            ))}
          </ol>
        )}

        {result.flags && result.flags.length > 0 && (
          <div className="space-y-1.5">
            {result.flags.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-md px-2.5 py-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{f.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {(result.primary_action || result.secondary_action || result.meta?.source) && (
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[11px] font-mono text-slate-400">{result.meta?.source}</span>
          <div className="flex items-center gap-2">
            {result.secondary_action && (
              <button
                onClick={() => onAction(result.secondary_action!)}
                className="text-xs font-medium text-slate-600 hover:text-violet-700 px-3 py-1.5 rounded-md transition-colors"
              >
                {result.secondary_action.label}
              </button>
            )}
            {result.primary_action && (
              <button onClick={() => onAction(result.primary_action!)} className={marketingPrimaryCtaSm}>
                <span className="relative font-semibold tracking-wide text-xs">{result.primary_action.label}</span>
                <ArrowRight className="relative h-3.5 w-3.5 text-white/90" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const INTENT_COPY: Record<string, { headline: string; sub: string }> = {
  execute_swap: { headline: "Sign in to execute this swap for real", sub: "Connect your wallet — we'll route the same Jupiter plan you just simulated." },
  execute_stake: { headline: "Sign in to stake", sub: "Stake under your own keys with Marinade, Jito, or BlazeStake — your call." },
  execute_rebalance: { headline: "Sign in to run this rebalance", sub: "Multi-leg execution under a Squads multisig with Glass Safety simulation." },
  save_strategy: { headline: "Save this strategy", sub: "Pin it to your treasury, schedule it, or share it with your team." },
  deploy_dca: { headline: "Sign in to deploy your DCA bot", sub: "Set the budget, cadence, and exit rules — pause anytime." },
  deploy_agent: { headline: "Sign in to deploy this agent", sub: "Bind tools, set risk envelope, run a 7-day backtest before going live." },
  scan_wallet: { headline: "Sign in to scan your wallet", sub: "We'll match your on-chain activity against every active airdrop program." },
  open_studio: { headline: "Sign in to open Dreyv Studio", sub: "Browser IDE + AI Architect — ship a mini-app in minutes." },
  open_foresight: { headline: "Sign in to model your real treasury", sub: "Connect your vault and run scenarios against live balances." },
  open_app: { headline: "Open Dreyv", sub: "Sign in to access your treasury, agents, and strategies." },
};

function AuthGate({ intent, onClose }: { intent: Action; onClose: () => void }) {
  const copy = INTENT_COPY[intent.intent] || INTENT_COPY.open_app;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 12 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden"
      >
        <div className="p-6">
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-violet-600">
            <DreyvStar size={14} className="text-violet-600" />
            One step away
          </div>
          <h3 className="mt-3 text-xl font-bold text-slate-900 tracking-tight">{copy.headline}</h3>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">{copy.sub}</p>

          <div className="mt-5 grid gap-2.5">
            <a
              href="/auth"
              className="flex items-center justify-between rounded-xl bg-violet-600 hover:bg-violet-500 transition-colors text-white px-4 py-3 text-sm font-semibold"
            >
              Sign in with email
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="/app"
              className="flex items-center justify-between rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors text-slate-900 px-4 py-3 text-sm font-semibold"
            >
              Connect Solana wallet
              <ExternalLink className="h-4 w-4 opacity-60" />
            </a>
          </div>

          <button onClick={onClose} className="mt-4 w-full text-xs text-slate-400 hover:text-slate-600 transition-colors">
            Keep exploring without signing in
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Keep a helper export to avoid tree-shaking warnings on first build.
export const _exampleCount = EXAMPLES.length;
