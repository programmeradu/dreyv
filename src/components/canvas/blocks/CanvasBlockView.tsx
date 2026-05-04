"use client";

/**
 * Render a CanvasBlock based on its `type` discriminator. Each renderer is
 * intentionally small and pulls only the fields it expects from `payload`.
 */

import type { CanvasBlock } from "@/lib/canvas/types";
import { BlockShell } from "../BlockShell";
import { Pill, StreamingNumber } from "@/components/app-shell/primitives";
import { TrendCurve } from "@/components/app-shell/Composition";
import { ArtifactList, type ArtifactDescriptor } from "@/components/commandbar/ArtifactChip";
import { AppEventBus } from "@/lib/events";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { TokenAvatar } from "@/components/TokenAvatar";
import { useDistributionFiles, parseDistributionFile, type DistributionEntry } from "@/lib/hooks/useDistributionFiles";
import { useVault, type RegisteredVault } from "@/lib/contexts/VaultContext";
import { useWallet } from "@/lib/wallet/compat";
import { useWalletModal } from "@/lib/wallet/compat";
import { parseCsv, readFileAsText } from "@/lib/csv";
import { ForesightWhatIfBlock } from "./ForesightWhatIfBlock";

/**
 * Lightweight markdown renderer for narrative/summary text.
 * Handles **bold** and `code`, strips stray standalone asterisks, and
 * preserves line breaks. Avoids pulling in a full markdown lib for
 * what is mostly short LLM replies inside cards.
 */
function MD({ text, className }: { text: string; className?: string }) {
  if (!text) return null;
  // Drop stray asterisks that aren't part of a **pair** or `*emphasis*`.
  const cleaned = text.replace(/\*{3,}/g, "**");
  const tokens: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(cleaned)) !== null) {
    if (m.index > last) tokens.push(cleaned.slice(last, m.index));
    if (m[1]) tokens.push(<strong key={i++} className="font-semibold text-slate-900">{m[1]}</strong>);
    else if (m[2]) tokens.push(<code key={i++} className="rounded bg-slate-100 px-1 py-0.5 text-[12px] font-mono text-slate-800">{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < cleaned.length) tokens.push(cleaned.slice(last));
  // Preserve line breaks
  const withBreaks: ReactNode[] = [];
  tokens.forEach((tok, idx) => {
    if (typeof tok === "string") {
      const parts = tok.split(/\n+/);
      parts.forEach((p, pi) => {
        if (pi > 0) withBreaks.push(<br key={`br-${idx}-${pi}`} />);
        if (p) withBreaks.push(p);
      });
    } else {
      withBreaks.push(tok);
    }
  });
  return <p className={className}>{withBreaks}</p>;
}

/** Body text with a 4-line clamp + Show more toggle when content is long. */
function ClampedBody({ text, className = "text-sm leading-relaxed text-slate-700" }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 220 || text.split(/\n/).length > 4;
  if (!isLong) return <MD text={text} className={className} />;
  // Apply line-clamp to the <p> directly (Tailwind line-clamp uses
  // -webkit-line-clamp, which only behaves correctly when set on the
  // element that actually contains the inline text — wrapping a <p>
  // in a clamped <div> swallows the "Show more" content silently).
  const clampClass = expanded ? "" : "line-clamp-4";
  return (
    <div>
      <MD text={text} className={`${className} ${clampClass}`.trim()} />
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-700 hover:text-violet-900"
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}

/** Brand glyphs — flat SVG marks instead of stock Lucide icons. */
const GlyphCheck = ({ className = "h-3 w-3" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M12 1.5 L14.2 9.8 L22.5 12 L14.2 14.2 L12 22.5 L9.8 14.2 L1.5 12 L9.8 9.8 Z" />
  </svg>
);
const GlyphAlert = ({ className = "h-3 w-3" }: { className?: string }) => (
  <svg viewBox="0 0 12 12" className={className} fill="currentColor">
    <path d="M6 1 11 10.5H1Zm0 3.6v3.2m0 1.4v.6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
  </svg>
);
const GlyphArrow = ({ className = "h-3.5 w-3.5" }: { className?: string }) => (
  <svg viewBox="0 0 14 14" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7h8m0 0L7.5 3.5M11 7l-3.5 3.5" />
  </svg>
);
const GlyphSpark = ({ className = "h-3.5 w-3.5" }: { className?: string }) => (
  <svg viewBox="0 0 14 14" className={className} fill="currentColor">
    <path d="M7 1.5 8 5.5l4 1-4 1L7 11.5 6 7.5l-4-1 4-1Z" />
  </svg>
);

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function CanvasBlockView({ block }: { block: CanvasBlock }) {
  switch (block.type) {
    case "narrative":
      return <NarrativeBlock block={block} />;
    case "metric":
      return <MetricBlock block={block} />;
    case "chart":
      return <ChartBlock block={block} />;
    case "plan":
      return <PlanBlock block={block} />;
    case "watcher":
      return <WatcherBlock block={block} />;
    case "decision":
      return <DecisionBlock block={block} />;
    case "capability-result":
      return <CapabilityResultBlock block={block} />;
    case "suggestion":
      return <SuggestionBlock block={block} />;
    case "artifact":
      return <ArtifactBlock block={block} />;
    case "research-brief":
      return <ResearchBriefBlock block={block} />;
    case "tokens-table":
      return <TokensTableBlock block={block} />;
    case "wallets-roster":
      return <WalletsRosterBlock block={block} />;
    case "runway":
      return <RunwayBlock block={block} />;
    case "empty-bucket":
      return <EmptyBucketBlock block={block} />;
    case "mass-send":
      return <MassSendBlock block={block} />;
    case "policy-approvals":
      return <PolicyApprovalsBlock block={block} />;
    case "recurring-payouts":
      return <RecurringPayoutsBlock block={block} />;
    case "gas-tank":
      return <GasTankBlock block={block} />;
    case "invoice-inbox":
      return <InvoiceInboxBlock block={block} />;
    case "yield-routing":
      return <YieldRoutingBlock block={block} />;
    case "reports-share":
      return <ReportsShareBlock block={block} />;
    case "wallet-security":
      return <WalletSecurityBlock block={block} />;
    case "foresight-whatif":
      return <ForesightWhatIfBlock block={block} />;
    default:
      return null;
  }
}

function NarrativeBlock({ block }: { block: CanvasBlock }) {
  const message = asString(block.payload.message ?? block.payload.detail);
  return (
    <BlockShell block={block} accent="slate">
      {message ? <ClampedBody text={message} /> : null}
    </BlockShell>
  );
}

function MetricBlock({ block }: { block: CanvasBlock }) {
  const value = asNumber(block.payload.value);
  const label = asString(block.payload.label, block.title);
  const hint = asString(block.payload.hint);
  const prefix = asString(block.payload.prefix);
  const suffix = asString(block.payload.suffix);
  const decimals = asNumber(block.payload.decimals) ?? 0;
  return (
    <BlockShell block={block} accent="violet">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <div className="mt-1 font-manrope text-3xl font-semibold tracking-tight text-slate-900">
            <StreamingNumber value={value} prefix={prefix} suffix={suffix} decimals={decimals} />
          </div>
        </div>
        {hint && <p className="max-w-[55%] text-right text-xs text-slate-500">{hint}</p>}
      </div>
    </BlockShell>
  );
}

function ChartBlock({ block }: { block: CanvasBlock }) {
  const series = asArray<number>(block.payload.series);
  const change = asNumber(block.payload.changePct);
  const label = asString(block.payload.label, block.title);
  if (series.length === 0) {
    return (
      <BlockShell block={block} accent="violet">
        <p className="text-sm text-slate-500">No data points yet.</p>
      </BlockShell>
    );
  }
  return (
    <BlockShell block={block} accent="violet">
      <TrendCurve values={series} label={label} changePct={change} />
    </BlockShell>
  );
}

function PlanBlock({ block }: { block: CanvasBlock }) {
  const steps = asArray<{ title?: string; detail?: string; status?: string }>(block.payload.steps);
  const summary = asString(block.payload.summary ?? block.payload.description);
  const status = asString(block.payload.status, "planning");
  const action = block.payload.action as { href?: string; label?: string } | undefined;

  const statusTone =
    status === "running" || status === "streaming"
      ? "violet"
      : status === "complete" || status === "success"
        ? "emerald"
        : status === "error" || status === "failed"
          ? "rose"
          : "slate";

  const stepBadge = (s: string | undefined, idx: number) => {
    if (s === "success" || s === "complete" || s === "done") {
      return (
        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-violet-600">
          <GlyphCheck className="h-3.5 w-3.5" />
        </span>
      );
    }
    if (s === "running" || s === "active") {
      return (
        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
        </span>
      );
    }
    if (s === "error" || s === "failed") {
      return (
        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
          <GlyphAlert />
        </span>
      );
    }
    return (
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-semibold text-violet-700">
        {idx + 1}
      </span>
    );
  };

  return (
    <BlockShell block={block} accent="violet">
      {status !== "error" && status !== "failed" && (
        <div className="mb-2 flex">
          <Pill tone={statusTone as "violet" | "emerald" | "rose" | "slate"}>
            {status === "running" || status === "streaming" ? (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            ) : null}
            {status}
          </Pill>
        </div>
      )}
      {summary && <ClampedBody text={summary} />}
      {steps.length > 0 && (
        <ol className="mt-3 space-y-2">
          {steps.slice(0, 8).map((s, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-slate-700">
              {stepBadge(s.status, i)}
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{asString(s.title, `Step ${i + 1}`)}</p>
                {s.detail && <p className="text-slate-600">{s.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {action?.href && (
        <div className="mt-4">
          <Link
            href={action.href}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-700"
          >
            {asString(action.label, "Open")}
            <GlyphArrow className="h-4 w-4" />
          </Link>
        </div>
      )}
    </BlockShell>
  );
}

function WatcherBlock({ block }: { block: CanvasBlock }) {
  const status = asString(block.payload.status, "watching");
  const condition = asString(block.payload.condition);
  return (
    <BlockShell block={block} accent="emerald">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-slate-700">{condition || "Conditions configured."}</div>
        <Pill tone={status === "triggered" ? "rose" : "emerald"}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {status}
        </Pill>
      </div>
    </BlockShell>
  );
}

function DecisionBlock({ block }: { block: CanvasBlock }) {
  const choices = asArray<{ label?: string; href?: string; tone?: "primary" | "ghost" }>(block.payload.choices);
  const rationale = asString(block.payload.rationale);
  return (
    <BlockShell block={block} accent="rose">
      {rationale && <p className="text-sm leading-relaxed text-slate-700">{rationale}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {choices.map((c, i) => {
          const tone = c.tone === "ghost";
          const cls = tone
            ? "rounded-xl px-4 py-2 text-sm font-medium text-slate-700 hover:bg-violet-50"
            : "rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700";
          return c.href ? (
            <Link key={i} href={c.href} className={cls}>
              {asString(c.label, "Continue")}
            </Link>
          ) : (
            <button key={i} className={cls} disabled>
              {asString(c.label, "Continue")}
            </button>
          );
        })}
      </div>
    </BlockShell>
  );
}

function CapabilityResultBlock({ block }: { block: CanvasBlock }) {
  const operation = asString(block.payload.operation);
  const success = block.payload.success !== false;
  const message = asString(block.payload.message ?? block.payload.summary);
  return (
    <BlockShell block={block} accent={success ? "emerald" : "rose"}>
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            success ? "text-violet-600" : "bg-rose-100 text-rose-700"
          }`}
        >
          {success ? <GlyphCheck className="h-4 w-4" /> : <GlyphAlert className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          {operation && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {operation}
            </p>
          )}
          {message && <div className="mt-1"><ClampedBody text={message} /></div>}
        </div>
      </div>
    </BlockShell>
  );
}

function SuggestionBlock({ block }: { block: CanvasBlock }) {
  const cta = block.payload.cta as { href?: string; label?: string } | undefined;
  return (
    <BlockShell block={block} accent="violet">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
          <GlyphSpark />
        </span>
        <div className="min-w-0 flex-1">
          {typeof block.payload.message === "string" && block.payload.message && (
            <p className="text-sm leading-relaxed text-slate-700">{asString(block.payload.message)}</p>
          )}
          {cta?.href && (
            <Link
              href={cta.href}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 hover:text-violet-900"
            >
              {asString(cta.label, "Open")}
              <GlyphArrow />
            </Link>
          )}
        </div>
      </div>
    </BlockShell>
  );
}

function ArtifactBlock({ block }: { block: CanvasBlock }) {
  const artifactsRaw = asArray<ArtifactDescriptor>(block.payload.artifacts);
  const artifacts = artifactsRaw.filter(
    (a) => a && typeof a.ref === "string" && typeof a.filename === "string",
  );
  const message = asString(block.payload.message);
  return (
    <BlockShell block={block} accent="violet">
      {message && <p className="mb-3 text-sm leading-relaxed text-slate-700">{message}</p>}
      {artifacts.length > 0 ? (
        <ArtifactList artifacts={artifacts} />
      ) : (
        <p className="text-sm text-slate-500">No deliverable attached.</p>
      )}
    </BlockShell>
  );
}

function ResearchBriefBlock({ block }: { block: CanvasBlock }) {
  const protocol = asString(block.payload.protocol, block.title);
  const summary = asString(block.payload.summary);
  const insights = asArray<string>(block.payload.insights);
  const suggestions = asArray<{ title?: string; detail?: string; cta?: string; href?: string }>(
    block.payload.suggestions,
  );
  const artifactsRaw = asArray<ArtifactDescriptor>(block.payload.artifacts);
  const artifacts = artifactsRaw.filter(
    (a) => a && typeof a.ref === "string" && typeof a.filename === "string",
  );

  const handleAct = (s: { title?: string; cta?: string; href?: string; detail?: string }) => {
    if (s.href) {
      window.location.href = s.href;
      return;
    }
    // Build a natural-language command for Dreyv. Prefer the CTA verb, fall
    // back to title, and append the protocol context so the planner has enough
    // signal. autoSubmit: true → CommandBar opens and runs immediately.
    const verb = (s.cta || s.title || `Act on ${protocol}`).trim();
    const command = /\b(kamino|jupiter|marinade|drift|orca|raydium|jito|meteora)\b/i.test(verb)
      ? verb
      : `${verb} (${protocol})`;
    AppEventBus.emit("AGENT_COMMAND", { command, autoSubmit: true });
  };

  return (
    <BlockShell block={block} accent="violet">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Pill tone="violet">
            <GlyphSpark className="h-3 w-3" />
            Research brief
          </Pill>
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {protocol}
          </span>
        </div>
        {summary && (
          <p className="text-sm leading-relaxed text-slate-700">{summary}</p>
        )}
        {insights.length > 0 && (
          <ul className="space-y-1.5">
            {insights.slice(0, 5).map((it, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-500" />
                <span>{it}</span>
              </li>
            ))}
          </ul>
        )}
        {artifacts.length > 0 && (
          <div className="pt-1">
            <ArtifactList artifacts={artifacts} />
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              What Dreyv can do for your treasury
            </p>
            <div className="grid gap-2">
              {suggestions.slice(0, 4).map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleAct(s)}
                  className="group flex items-start justify-between gap-3 rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2.5 text-left transition-colors hover:border-violet-300 hover:bg-violet-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {asString(s.title, "Try this")}
                    </p>
                    {s.detail && (
                      <p className="mt-0.5 text-xs text-slate-600">{s.detail}</p>
                    )}
                  </div>
                  <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-violet-700 transition-transform group-hover:translate-x-0.5">
                    {asString(s.cta, "Run")}
                    <GlyphArrow />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </BlockShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Treasury foundation blocks                                                 */
/* -------------------------------------------------------------------------- */

interface TokenRow {
  symbol: string;
  label?: string;
  logo?: string;
  mint?: string;
  balance?: number;
  value?: number;
  share?: number; // 0..1
  change24h?: number; // %
  source?: string; // wallet label
}

function fmtUsd(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtNum(n: number | null | undefined, decimals = 4): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

function TokensTableBlock({ block }: { block: CanvasBlock }) {
  const rows = asArray<TokenRow>(block.payload.rows);
  const total = asNumber(block.payload.totalValue);
  const empty = rows.length === 0;
  const [expanded, setExpanded] = React.useState(false);
  const COLLAPSED = 6;
  const visibleRows = expanded ? rows : rows.slice(0, COLLAPSED);
  const hiddenCount = Math.max(0, rows.length - COLLAPSED);

  const handleAct = (verb: string, sym: string) => {
    AppEventBus.emit("AGENT_COMMAND", { command: `${verb} ${sym}`, autoSubmit: false });
  };

  return (
    <BlockShell block={block} accent="violet">
      {empty ? (
        <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/40 px-4 py-6 text-center">
          <p className="text-sm text-slate-600">No tokens detected yet. Connect or paste a wallet to populate this view.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-violet-100">
          <div className="hidden grid-cols-[1.4fr_1fr_1fr_0.8fr_auto] gap-3 bg-violet-50/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 md:grid">
            <span>Asset</span>
            <span className="text-right">Balance</span>
            <span className="text-right">Value</span>
            <span className="text-right">24h</span>
            <span />
          </div>
          <ul className="divide-y divide-violet-100/70">
            {visibleRows.map((r) => {
              const tone = (r.change24h ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600";
              return (
                <li key={r.symbol} className="grid grid-cols-2 items-center gap-2 px-3 py-2 text-sm md:grid-cols-[1.4fr_1fr_1fr_0.8fr_auto] md:gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <TokenAvatar symbol={r.symbol} mint={r.mint} logo={r.logo} size={28} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900 leading-tight">{r.label ?? r.symbol}</p>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 leading-tight">{r.symbol}{r.source ? ` · ${r.source}` : ""}</p>
                    </div>
                  </div>
                  <p className="text-right tabular-nums text-slate-700">{fmtNum(r.balance)}</p>
                  <p className="text-right tabular-nums font-medium text-slate-900">{fmtUsd(r.value)}</p>
                  <p className={`text-right tabular-nums ${tone}`}>
                    {r.change24h === undefined || r.change24h === null ? "—" : `${r.change24h >= 0 ? "+" : ""}${r.change24h.toFixed(2)}%`}
                  </p>
                  <div className="col-span-2 mt-1 flex justify-end gap-1 md:col-span-1 md:mt-0">
                    <button onClick={() => handleAct("Send", r.symbol)} className="rounded-lg px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50">Send</button>
                    <button onClick={() => handleAct("Swap", r.symbol)} className="rounded-lg px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50">Swap</button>
                    <button onClick={() => handleAct("Earn yield on", r.symbol)} className="rounded-lg px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50">Earn</button>
                  </div>
                </li>
              );
            })}
          </ul>
          {hiddenCount > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="w-full border-t border-violet-100 bg-white px-4 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50/60"
            >
              {expanded ? "Show less" : `Show all ${rows.length} assets`}
            </button>
          )}
          {total !== null && (
            <div className="flex items-center justify-between border-t border-violet-100 bg-violet-50/40 px-4 py-2 text-xs">
              <span className="text-slate-500">{rows.length} assets</span>
              <span className="font-semibold tabular-nums text-slate-900">Total {fmtUsd(total)}</span>
            </div>
          )}
        </div>
      )}
    </BlockShell>
  );
}

interface WalletRow {
  address: string;
  label?: string;
  kind?: "hot" | "cold" | "multisig" | "watch";
  threshold?: number;
  members?: number;
  value?: number;
  pendingApprovals?: number;
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/**
 * Compact, interactive wallet & vault manager.
 *
 * Real affordances (no CommandBar detour):
 *  • Link a connected wallet via the existing wallet-adapter modal
 *  • Paste any Solana address to watch read-only
 *  • Switch the active vault (one click)
 *  • Inline rename + remove
 *  • Tier limit surfaced as a violet pill
 *
 * Squads multisig auto-detection is handled by VaultContext on activation —
 * we only mark `kind: 'multisig'` when the user explicitly toggles it.
 */
function WalletsRosterBlock({ block }: { block: CanvasBlock }) {
  // Legacy payload (still rendered if no live registry yet)
  const fallbackWallets = asArray<WalletRow>(block.payload.wallets);
  const {
    activeVault,
    setActiveVault,
    registeredVaults,
    registryLoading,
    tierLimit,
    addVault,
    renameVault,
    removeVault,
  } = useVault();
  const { setVisible: openWalletModal } = useWalletModal();
  const { publicKey, connected } = useWallet();

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteAddr, setPasteAddr] = useState("");
  const [pasteLabel, setPasteLabel] = useState("");
  const [pasteAsMultisig, setPasteAsMultisig] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const isValidAddr = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.trim());

  const onPaste = async () => {
    setErrMsg(null);
    const addr = pasteAddr.trim();
    if (!isValidAddr(addr)) { setErrMsg("Not a valid Solana address"); return; }
    setBusy(true);
    const res = await addVault({
      address: addr,
      label: pasteLabel.trim() || undefined,
      kind: pasteAsMultisig ? "multisig" : "watch",
    });
    setBusy(false);
    if (!res.ok) { setErrMsg(res.error); return; }
    setPasteAddr(""); setPasteLabel(""); setPasteAsMultisig(false); setPasteOpen(false);
    setActiveVault(res.vault.address);
  };

  // Auto-register a wallet that the user just connected via wallet-adapter,
  // if it's not already in the registry.
  useEffect(() => {
    if (!connected || !publicKey) return;
    const addr = publicKey.toBase58();
    const exists = registeredVaults.some((v) => v.address === addr);
    if (exists) return;
    addVault({ address: addr, kind: "connected" }).then((res) => {
      if (res.ok) setActiveVault(addr);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey?.toBase58()]);

  const limitReached = tierLimit && tierLimit.used >= tierLimit.limit;

  // If we have no live registry data yet, fall back to legacy renderer
  // so existing payloads keep working until the user signs in.
  const showLegacy = registeredVaults.length === 0 && !registryLoading && fallbackWallets.length > 0 && !connected;

  return (
    <BlockShell block={block} accent="violet">
      {/* Header strip — count + tier + add actions */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
          {registeredVaults.length} {registeredVaults.length === 1 ? "wallet" : "wallets"}
          {tierLimit && (
            <span className="ml-2 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
              {tierLimit.used}/{tierLimit.limit} · {tierLimit.tier}
            </span>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => openWalletModal(true)}
            disabled={limitReached === true}
            className="rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            + Link wallet
          </button>
          <button
            onClick={() => setPasteOpen((s) => !s)}
            disabled={limitReached === true}
            className="rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            + Watch address
          </button>
        </div>
      </div>

      {/* Paste-to-watch panel */}
      {pasteOpen && (
        <div className="mb-2 space-y-2 rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2.5">
          <input
            value={pasteAddr}
            onChange={(e) => { setPasteAddr(e.target.value); setErrMsg(null); }}
            placeholder="Paste a Solana address (wallet, Squads vault, treasury…)"
            className="w-full rounded-lg border border-violet-200 bg-white px-2.5 py-1.5 font-mono text-[12px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <div className="flex items-center gap-2">
            <input
              value={pasteLabel}
              onChange={(e) => setPasteLabel(e.target.value)}
              placeholder="Label (optional)"
              className="flex-1 rounded-lg border border-violet-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <input type="checkbox" checked={pasteAsMultisig} onChange={(e) => setPasteAsMultisig(e.target.checked)} className="accent-violet-600" />
              Squads multisig
            </label>
          </div>
          {errMsg && <p className="text-[11px] text-rose-600">{errMsg}</p>}
          <div className="flex items-center justify-end gap-1.5">
            <button onClick={() => { setPasteOpen(false); setErrMsg(null); }} className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700">Cancel</button>
            <button onClick={onPaste} disabled={busy || !pasteAddr.trim()} className="rounded-lg bg-violet-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
              {busy ? "Adding…" : "Watch"}
            </button>
          </div>
        </div>
      )}

      {limitReached && (
        <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          You've reached the {tierLimit?.tier} tier limit ({tierLimit?.limit} wallets).{" "}
          <Link href="/pricing" className="font-semibold underline">Upgrade</Link> to add more.
        </div>
      )}

      {/* Live registry */}
      {registeredVaults.length > 0 ? (
        <ul className="divide-y divide-violet-100/70 overflow-hidden rounded-xl border border-violet-100">
          {registeredVaults.map((w) => {
            const isActive = w.address === activeVault;
            const isEditing = editing === w.address;
            return (
              <li key={w.address} className={`flex items-center gap-2 px-3 py-2 text-[12px] ${isActive ? "bg-violet-50/60" : "bg-white hover:bg-violet-50/30"}`}>
                <button
                  onClick={() => setActiveVault(w.address)}
                  className={`h-2 w-2 shrink-0 rounded-full ${isActive ? "bg-violet-600" : "bg-slate-300 hover:bg-violet-400"}`}
                  aria-label={isActive ? "Active" : "Set active"}
                />
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onBlur={async () => {
                        const next = editLabel.trim();
                        if (next && next !== w.label) await renameVault(w.address, next);
                        setEditing(null);
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }}
                      className="w-full rounded border border-violet-300 bg-white px-1.5 py-0.5 text-[12px] font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-300"
                    />
                  ) : (
                    <button
                      onClick={() => { setEditing(w.address); setEditLabel(w.label); }}
                      className="block max-w-full truncate text-left font-semibold text-slate-900 hover:text-violet-700"
                      title="Click to rename"
                    >
                      {w.label}
                    </button>
                  )}
                  <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
                    <span className="font-mono">{shortAddr(w.address)}</span>
                    <Pill tone={w.kind === "multisig" ? "violet" : w.kind === "watch" ? "slate" : "emerald"}>{w.kind}</Pill>
                  </p>
                </div>
                {isActive && <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-700">Active</span>}
                <button
                  onClick={async () => {
                    if (!confirm(`Remove ${w.label}?`)) return;
                    await removeVault(w.address);
                  }}
                  className="text-[11px] text-slate-400 hover:text-rose-600"
                  aria-label="Remove wallet"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      ) : showLegacy ? (
        <ul className="space-y-2">
          {fallbackWallets.map((w) => (
            <li key={w.address} className="flex items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-white px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold text-slate-900">{w.label ?? shortAddr(w.address)}</p>
                  {w.kind && <Pill tone={w.kind === "multisig" ? "violet" : w.kind === "watch" ? "slate" : "emerald"}>{w.kind}</Pill>}
                </div>
                <p className="text-[11px] uppercase tracking-wider text-slate-500">
                  {shortAddr(w.address)}
                  {w.threshold && w.members ? ` · ${w.threshold}-of-${w.members}` : ""}
                </p>
              </div>
              <p className="tabular-nums font-medium text-slate-900">{fmtUsd(w.value)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-violet-200 bg-violet-50/40 px-4 py-5 text-center">
          <p className="text-[12px] text-slate-600">
            No wallets yet. Link Phantom/Solflare, paste an address to watch, or attach a Squads multisig.
          </p>
          <div className="mt-2.5 flex items-center justify-center gap-1.5">
            <button
              onClick={() => openWalletModal(true)}
              className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
            >
              Link wallet
            </button>
            <button
              onClick={() => setPasteOpen(true)}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-700"
            >
              Paste address
            </button>
          </div>
        </div>
      )}
    </BlockShell>
  );
}

function RunwayBlock({ block }: { block: CanvasBlock }) {
  const wallet = asString(block.payload.wallet);
  const stableBalance = asNumber(block.payload.stableBalance);
  // Allow seeded numeric overrides too (kept for back-compat / agents)
  const seededMonths = asNumber(block.payload.months);
  const seededBurn = asNumber(block.payload.monthlyBurn);

  const [loading, setLoading] = useState<boolean>(!!wallet);
  const [burn, setBurn] = useState<number | null>(seededBurn);
  const [inflow, setInflow] = useState<number | null>(null);
  const [sample, setSample] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/treasury/events?wallet=${wallet}&range=90d`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        const agg = json?.aggregates ?? {};
        setBurn(typeof agg.monthlyBurnRate === "number" ? agg.monthlyBurnRate : null);
        setInflow(typeof agg.monthlyInflow === "number" ? agg.monthlyInflow : null);
        setSample(Number(agg.sampleSize) || 0);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [wallet]);

  if (!wallet) {
    return (
      <BlockShell block={block} accent="slate">
        <p className="text-sm text-slate-600">Connect a wallet to estimate your runway from real on-chain outflows.</p>
      </BlockShell>
    );
  }

  if (loading) {
    return (
      <BlockShell block={block} accent="slate">
        <p className="text-sm text-slate-500">Reading the last 90 days of treasury activity…</p>
      </BlockShell>
    );
  }

  if (error) {
    return (
      <BlockShell block={block} accent="slate">
        <p className="text-sm text-slate-600">Couldn&apos;t load runway data ({error}). It will retry on next refresh.</p>
      </BlockShell>
    );
  }

  // No real outflows yet → honest empty state, never invent.
  const burnUsable = typeof burn === "number" && burn > 0;
  const balanceUsable = typeof stableBalance === "number" && stableBalance > 0;
  const months = burnUsable && balanceUsable ? stableBalance / burn : (seededMonths ?? null);

  if (months === null) {
    return (
      <BlockShell block={block} accent="slate">
        <p className="text-sm text-slate-600">
          {sample === 0
            ? "No outflows recorded yet for this wallet. Once Dreyv watches a few outflows (or you log them via the events API), runway fills in automatically."
            : burnUsable
              ? "No stable balance to draw from yet — top up USDC/USDT to see runway."
              : "Burn rate is effectively zero right now, so runway is unbounded at current pace."}
        </p>
      </BlockShell>
    );
  }

  const tone = months >= 18 ? "emerald" : months >= 9 ? "violet" : "rose";
  const netHint = inflow != null && burn != null
    ? `${fmtUsd(inflow)} in / ${fmtUsd(burn)} out per month`
    : `at ${fmtUsd(burn)}/mo burn`;

  return (
    <BlockShell block={block} accent={tone === "rose" ? "rose" : "violet"}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Runway</p>
          <p className="mt-1 font-manrope text-3xl font-semibold tracking-tight text-slate-900">
            <StreamingNumber value={months} decimals={1} suffix=" months" />
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {netHint} · {fmtUsd(stableBalance)} stable balance
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-400">
            Based on {sample} event{sample === 1 ? "" : "s"} over 90 days
          </p>
        </div>
        <Pill tone={tone as "violet" | "emerald" | "rose"}>
          {months >= 18 ? "Healthy" : months >= 9 ? "Comfortable" : "Tight"}
        </Pill>
      </div>
    </BlockShell>
  );
}

function EmptyBucketBlock({ block }: { block: CanvasBlock }) {
  const description = asString(block.payload.description);
  const prompt = asString(block.payload.prompt);
  return (
    <BlockShell block={block} accent="slate">
      {description && <p className="text-sm text-slate-700">{description}</p>}
      <button
        onClick={() => AppEventBus.emit("AGENT_COMMAND", { command: prompt || `Set up ${block.title}`, autoSubmit: false })}
        className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 hover:text-violet-900"
      >
        Ask Dreyv to set this up
        <GlyphArrow />
      </button>
    </BlockShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Mass send-outs — Phase 4                                                   */
/* -------------------------------------------------------------------------- */

interface MassSendRecipient {
  address: string;
  amount: number;
  token?: string;
  memo?: string;
  error?: string;
}

/** Convert parsed DistributionEntry rows into MassSendRecipient (apply default token). */
function entriesToRecipients(entries: DistributionEntry[], defaultToken: string): MassSendRecipient[] {
  return entries.map((e) => ({
    address: e.address,
    amount: e.amount,
    token: (e.token || defaultToken).toUpperCase(),
    memo: e.label,
  }));
}

/** Lightweight inline parser for the textarea fallback — defers to the shared CSV parser shape. */
function parseRecipientsText(raw: string, defaultToken: string): MassSendRecipient[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.toLowerCase().startsWith("address,"));
  return lines.map((line) => {
    const parts = line.split(/[,\t]/).map((p) => p.trim());
    const [address = "", amountRaw = "", token = defaultToken, memo = ""] = parts;
    const amount = Number(amountRaw);
    let error: string | undefined;
    if (!address || address.length < 32 || address.length > 64) error = "invalid address";
    else if (!Number.isFinite(amount) || amount <= 0) error = "invalid amount";
    return { address, amount, token: (token || defaultToken).toUpperCase(), memo, error };
  });
}

function MassSendBlock({ block }: { block: CanvasBlock }) {
  const wallet = asString(block.payload.wallet);
  const isMultisig = block.payload.isMultisig === true;
  const [defaultToken, setDefaultToken] = useState<string>(asString(block.payload.defaultToken, "USDC"));
  const [raw, setRaw] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  const { files: savedFiles, saveFile, deleteFile } = useDistributionFiles();

  const recipients = useMemo(() => parseRecipientsText(raw, defaultToken), [raw, defaultToken]);
  const valid = recipients.filter((r) => !r.error);
  const totalAmount = valid.reduce((s, r) => s + r.amount, 0);
  const invalidCount = recipients.length - valid.length;

  const ingestFile = async (file: File) => {
    setParseErrors([]);
    setActiveFileName(file.name);
    const result = await parseDistributionFile(file);
    if (result.errors.length) setParseErrors(result.errors.slice(0, 5));
    if (result.entries.length) {
      // Auto-detect token if uniform & not USDC default
      const tokens = new Set(result.entries.map((e) => e.token).filter(Boolean));
      if (tokens.size === 1) {
        const t = [...tokens][0]!.toUpperCase();
        if (["USDC", "USDT", "SOL", "JUP", "BONK"].includes(t)) setDefaultToken(t);
      }
      // Render into textarea so the user can still edit before queuing
      const text = result.entries
        .map((e) => [e.address, e.amount, e.token || "", e.label || ""].filter(Boolean).join(","))
        .join("\n");
      setRaw(text);
      // Persist to saved files for reuse
      saveFile(file.name, result.entries, result.sourceType);
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await ingestFile(file);
    e.target.value = "";
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await ingestFile(file);
  };

  const loadSaved = (id: string) => {
    const f = savedFiles.find((x) => x.id === id);
    if (!f) return;
    setActiveFileName(f.name);
    const text = f.entries
      .map((e) => [e.address, e.amount, e.token || "", e.label || ""].filter(Boolean).join(","))
      .join("\n");
    setRaw(text);
    setShowSaved(false);
  };

  const queue = async () => {
    if (!wallet || valid.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/inbox/tx-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet,
          kind: "mass-send",
          summary: `Mass payout · ${valid.length} recipients · ${totalAmount.toLocaleString()} ${defaultToken}`,
          riskLevel: totalAmount > 10_000 ? "high" : totalAmount > 1_000 ? "medium" : "low",
          routing: isMultisig ? "multisig" : "wallet",
          instructions: valid.map((r) => ({
            op: "transfer",
            params: { recipient: r.address, amount: r.amount, token: r.token, memo: r.memo || undefined },
          })),
          meta: { source: "treasury/mass-send", recipientCount: valid.length, totalAmount, defaultToken, sourceFile: activeFileName },
          ttlMinutes: 240,
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        setQueuedId(data.id);
        setRaw("");
        setActiveFileName(null);
      } else {
        setQueuedId(null);
      }
    } catch {
      setQueuedId(null);
    } finally {
      setSubmitting(false);
    }
  };

  if (!wallet) {
    return (
      <BlockShell block={block} accent="violet">
        <p className="text-sm text-slate-600">Connect a wallet to enable mass payouts.</p>
      </BlockShell>
    );
  }

  return (
    <BlockShell block={block} accent="violet">
      <div className="space-y-3">
        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={`relative rounded-xl border-2 border-dashed px-3 py-3 text-center transition-colors ${
            isDragging ? "border-violet-500 bg-violet-50" : "border-violet-200 bg-violet-50/40 hover:bg-violet-50"
          }`}
        >
          <p className="text-[12px] text-slate-700">
            <span className="font-semibold text-violet-700">Drop a CSV or JSON</span>
            <span className="text-slate-500"> · or </span>
            <label className="cursor-pointer font-semibold text-violet-700 underline-offset-2 hover:underline">
              browse
              <input type="file" accept=".csv,.tsv,.txt,.json" className="hidden" onChange={onPickFile} />
            </label>
            {savedFiles.length > 0 && (
              <>
                <span className="text-slate-500"> · </span>
                <button
                  type="button"
                  onClick={() => setShowSaved((s) => !s)}
                  className="font-semibold text-violet-700 hover:underline"
                >
                  reuse saved ({savedFiles.length})
                </button>
              </>
            )}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            Columns auto-detected: address, amount, token, label · addresses validated · saved for reuse
          </p>
          {activeFileName && (
            <p className="mt-1 text-[10px] font-mono text-violet-700">📄 {activeFileName}</p>
          )}
        </div>

        {/* Saved files dropdown */}
        {showSaved && savedFiles.length > 0 && (
          <div className="rounded-xl border border-violet-100 bg-white">
            <ul className="max-h-32 divide-y divide-violet-100/70 overflow-y-auto">
              {savedFiles.slice(0, 10).map((f) => (
                <li key={f.id} className="flex items-center justify-between px-3 py-1.5 text-[12px]">
                  <button
                    onClick={() => loadSaved(f.id)}
                    className="flex-1 text-left hover:text-violet-700"
                  >
                    <span className="font-medium text-slate-800">{f.name}</span>
                    <span className="ml-2 text-[10px] text-slate-500">
                      {f.recipientCount} · {f.totalAmount.toLocaleString()} {f.tokenSummary}
                    </span>
                  </button>
                  <button
                    onClick={() => deleteFile(f.id)}
                    className="text-[10px] text-slate-400 hover:text-rose-600"
                    aria-label="Delete saved file"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {parseErrors.length > 0 && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
            {parseErrors.map((e, i) => <div key={i}>· {e}</div>)}
          </div>
        )}

        {/* Default token + manual paste */}
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Default token</label>
          <select
            value={defaultToken}
            onChange={(e) => setDefaultToken(e.target.value)}
            className="rounded-lg border border-violet-200 bg-white px-2 py-1 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300"
          >
            {["USDC", "USDT", "SOL", "JUP", "BONK"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <span className="ml-auto text-[10px] text-slate-500">or paste below</span>
        </div>

        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={4}
          placeholder={`So11…AbC,250\n9wM…XyZ,500,USDC,June grant`}
          className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2 font-mono text-[12px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
        />

        {recipients.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-violet-100">
            <div className="min-w-[420px]">
              <div className="grid grid-cols-[1.4fr_0.7fr_0.5fr_auto] gap-2 bg-violet-50/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <span>Recipient</span><span className="text-right">Amount</span><span>Token</span><span className="text-right">Status</span>
              </div>
              <ul className="max-h-40 divide-y divide-violet-100/70 overflow-y-auto">
                {recipients.slice(0, 50).map((r, i) => (
                  <li key={`${r.address}-${i}`} className="grid grid-cols-[1.4fr_0.7fr_0.5fr_auto] items-center gap-2 px-3 py-1.5 text-[12px]">
                    <span className="truncate font-mono text-slate-700">{r.address ? `${r.address.slice(0,4)}…${r.address.slice(-4)}` : "—"}</span>
                    <span className="text-right tabular-nums text-slate-900">{Number.isFinite(r.amount) ? r.amount.toLocaleString() : "—"}</span>
                    <span className="text-slate-600">{r.token}</span>
                    <span className={`text-right text-[10px] font-semibold uppercase tracking-wider ${r.error ? "text-rose-600" : "text-emerald-600"}`}>
                      {r.error ?? "ok"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="flex flex-col items-stretch justify-between gap-2 border-t border-violet-100 pt-3 sm:flex-row sm:items-center sm:gap-3">
          <p className="text-[11px] text-slate-500">
            {valid.length} valid · {invalidCount} skipped · total {totalAmount.toLocaleString()} {defaultToken}
            {isMultisig && " · routes via Squads"}
          </p>
          <div className="flex items-center gap-2">
            {queuedId && (
              <Link href="/app/inbox" className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700">
                Queued ✓ open inbox
              </Link>
            )}
            <button
              onClick={queue}
              disabled={submitting || valid.length === 0}
              className="rounded-xl bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Queuing…" : `Queue ${valid.length} for approval`}
            </button>
          </div>
        </div>
      </div>
    </BlockShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Policy & approvals — Phase 4                                               */
/* -------------------------------------------------------------------------- */

interface PolicyDoc {
  autoApproveBelowUsd: number;
  requireMultisigAboveUsd: number | null;
  dailyValueCapUsd: number | null;
  protocolAllowlist: string[];
  protocolDenylist: string[];
  allowDynamicWrites: boolean;
}

interface ApprovalRow {
  id: string;
  reason?: string;
  status?: string;
  riskScore?: number | string | null;
  estimatedValueUsd?: number | string | null;
  createdAt?: string;
  plan?: { summary?: string; description?: string };
}

interface TxQueueRow {
  id: string;
  summary: string;
  riskLevel?: string;
  estimatedFeeSol?: string | null;
  routing?: string;
  createdAt?: string;
}

const DEFAULT_POLICY: PolicyDoc = {
  autoApproveBelowUsd: 0,
  requireMultisigAboveUsd: null,
  dailyValueCapUsd: null,
  protocolAllowlist: [],
  protocolDenylist: [],
  allowDynamicWrites: false,
};

function PolicyApprovalsBlock({ block }: { block: CanvasBlock }) {
  const wallet = asString(block.payload.wallet);
  const [policy, setPolicy] = useState<PolicyDoc>(DEFAULT_POLICY);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [txQueue, setTxQueue] = useState<TxQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const [pRes, aRes, txRes] = await Promise.all([
        fetch(`/api/dacs/policy?wallet=${wallet}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/dacs/approvals?wallet=${wallet}&status=pending`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/inbox/tx-proposals?wallet=${wallet}&status=queued`, { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (pRes?.ok && pRes.policy) {
        const p = pRes.policy;
        setPolicy({
          autoApproveBelowUsd: Number(p.autoApproveBelowUsd ?? 0),
          requireMultisigAboveUsd: p.requireMultisigAboveUsd != null ? Number(p.requireMultisigAboveUsd) : null,
          dailyValueCapUsd: p.dailyValueCapUsd != null ? Number(p.dailyValueCapUsd) : null,
          protocolAllowlist: Array.isArray(p.protocolAllowlist) ? p.protocolAllowlist : [],
          protocolDenylist: Array.isArray(p.protocolDenylist) ? p.protocolDenylist : [],
          allowDynamicWrites: Boolean(p.allowDynamicWrites),
        });
      }
      setApprovals(aRes?.approvals ?? []);
      setTxQueue(txRes?.txProposals ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  const savePolicy = async () => {
    if (!wallet) return;
    setSavingPolicy(true);
    try {
      await fetch("/api/dacs/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet, ...policy }),
      });
    } finally {
      setSavingPolicy(false);
    }
  };

  const resolveApproval = async (id: string, action: "approve" | "reject") => {
    setBusyId(id);
    try {
      await fetch("/api/dacs/approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, resolvedBy: wallet }),
      });
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } finally {
      setBusyId(null);
    }
  };

  if (!wallet) {
    return (
      <BlockShell block={block} accent="violet">
        <p className="text-sm text-slate-600">Connect a wallet to manage policy and approvals.</p>
      </BlockShell>
    );
  }

  const pendingTotal = approvals.length + txQueue.length;

  return (
    <BlockShell block={block} accent="violet">
      <div className="space-y-3">
        {/* Status row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Pill tone={pendingTotal > 0 ? "rose" : "emerald"}>
              {pendingTotal > 0 ? `${pendingTotal} pending` : "All clear"}
            </Pill>
            <span className="text-[11px] text-slate-500">
              auto-approve ≤ {fmtUsd(policy.autoApproveBelowUsd, 0)}
              {policy.dailyValueCapUsd != null && ` · cap ${fmtUsd(policy.dailyValueCapUsd, 0)}/day`}
            </span>
          </div>
          {loading && <span className="text-[10px] uppercase tracking-wider text-slate-400">syncing…</span>}
        </div>

        {/* Pending tx queue (HITL signs) */}
        {txQueue.length > 0 && (
          <div className="rounded-xl border border-violet-100">
            <div className="flex items-center justify-between bg-violet-50/60 px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Pending signatures</span>
              <Link href="/app/inbox" className="text-[10px] font-semibold uppercase tracking-wider text-violet-700 hover:text-violet-900">Open inbox →</Link>
            </div>
            <ul className="divide-y divide-violet-100/70">
              {txQueue.slice(0, 3).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]">
                  <span className="min-w-0 truncate text-slate-800">{t.summary}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-500">{t.routing} · {t.riskLevel}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Plan-level approvals (DACS HITL) */}
        {approvals.length > 0 && (
          <div className="rounded-xl border border-violet-100">
            <div className="bg-violet-50/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Plans awaiting you
            </div>
            <ul className="divide-y divide-violet-100/70">
              {approvals.slice(0, 4).map((a) => {
                const value = typeof a.estimatedValueUsd === "string" ? Number(a.estimatedValueUsd) : a.estimatedValueUsd ?? null;
                return (
                  <li key={a.id} className="px-3 py-2 text-[12.5px]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{a.plan?.summary || a.reason || "Plan"}</p>
                        <p className="text-[10.5px] uppercase tracking-wider text-slate-500">
                          {value != null ? fmtUsd(value, 0) : "value n/a"}
                          {a.riskScore != null && ` · risk ${typeof a.riskScore === "string" ? a.riskScore : a.riskScore.toFixed(2)}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => resolveApproval(a.id, "approve")}
                          disabled={busyId === a.id}
                          className="rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                        >Approve</button>
                        <button
                          onClick={() => resolveApproval(a.id, "reject")}
                          disabled={busyId === a.id}
                          className="rounded-lg border border-violet-200 px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                        >Reject</button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Compact policy editor */}
        <div className="rounded-xl border border-violet-100 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Guardrails</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <PolicyNum
              label="Auto-approve ≤"
              value={policy.autoApproveBelowUsd}
              onChange={(v) => setPolicy((s) => ({ ...s, autoApproveBelowUsd: v ?? 0 }))}
            />
            <PolicyNum
              label="Multisig >"
              value={policy.requireMultisigAboveUsd}
              onChange={(v) => setPolicy((s) => ({ ...s, requireMultisigAboveUsd: v }))}
            />
            <PolicyNum
              label="Daily cap"
              value={policy.dailyValueCapUsd}
              onChange={(v) => setPolicy((s) => ({ ...s, dailyValueCapUsd: v }))}
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <Link href="/app/settings" className="text-[10px] font-semibold uppercase tracking-wider text-violet-700 hover:text-violet-900">
              Full policy →
            </Link>
            <button
              onClick={savePolicy}
              disabled={savingPolicy}
              className="rounded-lg bg-violet-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {savingPolicy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </BlockShell>
  );
}

function PolicyNum({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <div className="mt-1 flex items-center rounded-lg border border-violet-200 bg-white px-2 py-1 text-xs">
        <span className="text-slate-400">$</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          value={value ?? ""}
          placeholder="—"
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="w-full bg-transparent pl-1 font-mono text-slate-900 focus:outline-none"
        />
      </div>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Phase 6 — Payments & Treasury Operations                                   */
/* -------------------------------------------------------------------------- */

interface RecurringSchedule {
  id: string;
  label: string;
  cadence: string;
  anchorDay: number | null;
  defaultToken: string;
  recipients: { address: string; amount: number; label?: string }[];
  status: "active" | "paused" | "archived";
  nextRunAt: string | null;
  lastRunAt: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  catch { return "—"; }
}

function RecurringPayoutsBlock({ block }: { block: CanvasBlock }) {
  const wallet = asString(block.payload.wallet);
  const [schedules, setSchedules] = useState<RecurringSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Form state
  const [label, setLabel] = useState("");
  const [cadence, setCadence] = useState("monthly");
  const [anchorDay, setAnchorDay] = useState<number>(1);
  const [defaultToken, setDefaultToken] = useState("USDC");
  const [recipientsRaw, setRecipientsRaw] = useState("");

  const refresh = async () => {
    if (!wallet) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/treasury/recurring-payouts?wallet=${wallet}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setSchedules(json.schedules ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load schedules");
    }
    setLoading(false);
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wallet]);

  const onCsv = async (file: File) => {
    setErr(null);
    try {
      const text = await readFileAsText(file);
      const { headers, rows } = parseCsv(text);
      // Best-effort column mapping — accept (address, amount, label) in any order
      // when headers are present, otherwise assume positional order.
      let addrIdx = 0, amtIdx = 1, labIdx = 2;
      if (headers) {
        const find = (re: RegExp) => headers.findIndex((h) => re.test(h));
        const a = find(/address|wallet|recipient|to/i);
        const m = find(/amount|value|qty/i);
        const l = find(/label|name|memo|note/i);
        if (a >= 0) addrIdx = a;
        if (m >= 0) amtIdx = m;
        if (l >= 0) labIdx = l;
      }
      const lines = rows
        .map((r) => {
          const addr = (r[addrIdx] ?? "").trim();
          const amt = Number(r[amtIdx]);
          const lab = (r[labIdx] ?? "").trim();
          if (!addr || !(amt > 0)) return null;
          return lab ? `${addr},${amt},${lab}` : `${addr},${amt}`;
        })
        .filter(Boolean) as string[];
      if (lines.length === 0) { setErr("No valid recipients found in CSV."); return; }
      setRecipientsRaw((prev) => (prev.trim() ? prev + "\n" : "") + lines.join("\n"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to read CSV");
    }
  };

  const submit = async () => {
    setErr(null);
    if (!label.trim() || !recipientsRaw.trim()) { setErr("Label and recipients are required."); return; }
    setBusy("create");
    const recipients = recipientsRaw
      .split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      .map((line) => {
        const [address, amountRaw, lab] = line.split(/[,\t]/).map((p) => p.trim());
        return { address, amount: Number(amountRaw), label: lab || undefined };
      })
      .filter((r) => r.address && r.amount > 0);
    if (recipients.length === 0) { setErr("No valid recipients parsed."); setBusy(null); return; }
    try {
      const res = await fetch("/api/treasury/recurring-payouts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, label, cadence, anchorDay, defaultToken, recipients }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLabel(""); setRecipientsRaw(""); setShowForm(false);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save schedule");
    }
    setBusy(null);
  };

  const action = async (id: string, action: string) => {
    setBusy(id);
    await fetch("/api/treasury/recurring-payouts", {
      method: action === "delete" ? "DELETE" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: action === "delete" ? undefined : JSON.stringify({ id, action }),
      ...(action === "delete" ? {} : {}),
    });
    if (action === "delete") {
      await fetch(`/api/treasury/recurring-payouts?id=${id}`, { method: "DELETE" });
    }
    setBusy(null);
    refresh();
  };

  const active = schedules.filter((s) => s.status !== "archived");

  return (
    <BlockShell block={block} accent="violet">
      {!wallet ? (
        <p className="text-sm text-slate-600">Connect a wallet to schedule recurring payouts.</p>
      ) : (
        <>
          {err && !showForm && (
            <p className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">{err}</p>
          )}
          {loading && active.length === 0 ? (
            <p className="text-sm text-slate-500">Loading schedules…</p>
          ) : active.length === 0 ? (
            <p className="text-sm text-slate-600">No recurring payouts yet. Set one up for payroll, grants, or contributors.</p>
          ) : (
            <ul className="divide-y divide-violet-100">
              {active.map((s) => {
                const total = s.recipients.reduce((sum, r) => sum + r.amount, 0);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-slate-900">{s.label}</span>
                        <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">{s.cadence}</span>
                        {s.status === "paused" && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Paused</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[12px] text-slate-500">
                        {s.recipients.length} recipients · {total.toLocaleString()} {s.defaultToken} · next {fmtDate(s.nextRunAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => action(s.id, "queue-now")}
                        disabled={busy === s.id || s.status !== "active"}
                        className="rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                      >Run now</button>
                      <button
                        onClick={() => action(s.id, s.status === "paused" ? "resume" : "pause")}
                        disabled={busy === s.id}
                        className="rounded-lg border border-violet-200 px-2 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
                      >{s.status === "paused" ? "Resume" : "Pause"}</button>
                      <button
                        onClick={() => action(s.id, "delete")}
                        disabled={busy === s.id}
                        className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-400 hover:text-rose-600"
                      >×</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:text-violet-900"
            >+ New schedule</button>
          ) : (
            <div className="mt-3 space-y-2 rounded-lg border border-violet-100 bg-violet-50/40 p-3">
              <div className="grid grid-cols-2 gap-2">
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Engineering payroll"
                  className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none" />
                <select value={cadence} onChange={(e) => setCadence(e.target.value)}
                  className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm text-slate-900">
                  <option value="monthly">Monthly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="weekly">Weekly</option>
                  <option value="manual">Manual only</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" min={1} max={28} value={anchorDay} onChange={(e) => setAnchorDay(Number(e.target.value))}
                  placeholder="Day of month" className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm text-slate-900" />
                <select value={defaultToken} onChange={(e) => setDefaultToken(e.target.value)}
                  className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm text-slate-900">
                  <option value="USDC">USDC</option>
                  <option value="USDT">USDT</option>
                  <option value="SOL">SOL</option>
                </select>
              </div>
              <textarea
                value={recipientsRaw} onChange={(e) => setRecipientsRaw(e.target.value)}
                rows={3}
                placeholder="address,amount,label per line"
                className="w-full rounded-md border border-violet-200 bg-white px-2 py-1.5 font-mono text-[12px] text-slate-900 placeholder:text-slate-400"
              />
              <div className="flex items-center justify-between gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50">
                  Upload CSV
                  <input
                    type="file" accept=".csv,text/csv,text/plain" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onCsv(f); e.currentTarget.value = ""; }}
                  />
                </label>
                <p className="text-[10px] text-slate-400">Headers <span className="font-mono">address,amount,label</span> auto-detected</p>
              </div>
              {err && <p className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">{err}</p>}
              <div className="flex items-center gap-2">
                <button onClick={submit} disabled={busy === "create"}
                  className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                  {busy === "create" ? "Saving…" : "Save schedule"}
                </button>
                <button onClick={() => { setShowForm(false); setErr(null); }}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700">Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </BlockShell>
  );
}

/* ---- Gas tank watcher ---------------------------------------------------- */

interface GasTankWatcher {
  id: string;
  vaultAddress: string;
  minSol: string;
  targetSol: string;
  fundingAddress: string | null;
  capPerTopupSol: string;
  status: "active" | "paused";
  lastBalanceSol: string | null;
  lastCheckedAt: string | null;
  lastTopupAt: string | null;
}

function GasTankBlock({ block }: { block: CanvasBlock }) {
  const wallet = asString(block.payload.wallet);
  const [watcher, setWatcher] = useState<GasTankWatcher | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const [minSol, setMinSol] = useState(0.5);
  const [targetSol, setTargetSol] = useState(2);
  const [fundingAddress, setFundingAddress] = useState("");
  const [cap, setCap] = useState(1);

  const refresh = async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/treasury/gas-tank?wallet=${wallet}`);
      const json = await res.json();
      setWatcher(json.watcher);
      if (json.watcher) {
        setMinSol(Number(json.watcher.minSol));
        setTargetSol(Number(json.watcher.targetSol));
        setFundingAddress(json.watcher.fundingAddress ?? "");
        setCap(Number(json.watcher.capPerTopupSol));
      }
    } catch { /* ignore */ }
    setLoading(false);
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wallet]);

  const save = async () => {
    setBusy("save");
    await fetch("/api/treasury/gas-tank", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, minSol, targetSol, fundingAddress: fundingAddress || null, capPerTopupSol: cap }),
    });
    setBusy(null); setEditing(false); refresh();
  };

  const action = async (a: string) => {
    setBusy(a);
    await fetch("/api/treasury/gas-tank", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, action: a }),
    });
    setBusy(null); refresh();
  };

  if (!wallet) {
    return <BlockShell block={block} accent="slate"><p className="text-sm text-slate-600">Connect a wallet to enable a gas-tank watcher.</p></BlockShell>;
  }

  if (loading && !watcher) {
    return <BlockShell block={block} accent="slate"><p className="text-sm text-slate-500">Loading…</p></BlockShell>;
  }

  if (!watcher && !editing) {
    return (
      <BlockShell block={block} accent="slate">
        <p className="text-sm text-slate-700">Auto-refill SOL on this vault when it dips below your floor — Dreyv watches and proposes a top-up via HITL.</p>
        <button onClick={() => setEditing(true)} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:text-violet-900">
          + Set up gas tank
        </button>
      </BlockShell>
    );
  }

  if (editing) {
    return (
      <BlockShell block={block} accent="violet">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Field label="Floor (SOL)"><input type="number" step="0.1" value={minSol} onChange={(e) => setMinSol(Number(e.target.value))} className="w-full rounded-md border border-violet-200 bg-white px-2 py-1 text-sm" /></Field>
            <Field label="Target (SOL)"><input type="number" step="0.1" value={targetSol} onChange={(e) => setTargetSol(Number(e.target.value))} className="w-full rounded-md border border-violet-200 bg-white px-2 py-1 text-sm" /></Field>
            <Field label="Cap / top-up"><input type="number" step="0.1" value={cap} onChange={(e) => setCap(Number(e.target.value))} className="w-full rounded-md border border-violet-200 bg-white px-2 py-1 text-sm" /></Field>
          </div>
          <Field label="Funding address (where SOL comes from)">
            <input value={fundingAddress} onChange={(e) => setFundingAddress(e.target.value)} placeholder="Solana address" className="w-full rounded-md border border-violet-200 bg-white px-2 py-1 font-mono text-[12px]" />
          </Field>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={busy === "save"} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button onClick={() => { setEditing(false); refresh(); }} className="text-xs font-semibold text-slate-500 hover:text-slate-700">Cancel</button>
          </div>
        </div>
      </BlockShell>
    );
  }

  const w = watcher!;
  const balanceN = w.lastBalanceSol != null ? Number(w.lastBalanceSol) : null;
  const minN = Number(w.minSol);
  const tone = balanceN == null ? "slate" : balanceN < minN ? "rose" : "emerald";

  return (
    <BlockShell block={block} accent={tone === "rose" ? "rose" : "violet"}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-tight text-slate-900">
            {balanceN != null ? balanceN.toFixed(3) : "—"}
          </span>
          <span className="text-xs text-slate-500">SOL · floor {minN} · target {Number(w.targetSol)}</span>
        </div>
        <Pill tone={tone === "rose" ? "rose" : tone === "emerald" ? "emerald" : "violet"}>
          {w.status === "paused" ? "Paused" : balanceN == null ? "Unchecked" : balanceN < minN ? "Low" : "Healthy"}
        </Pill>
      </div>
      <p className="mt-1 text-[12px] text-slate-500">
        {w.lastCheckedAt ? `checked ${new Date(w.lastCheckedAt).toLocaleString()}` : "not checked yet"}
        {w.fundingAddress ? ` · funded from ${w.fundingAddress.slice(0, 6)}…${w.fundingAddress.slice(-4)}` : " · no funding source set"}
      </p>
      <div className="mt-3 flex items-center gap-1.5">
        <button onClick={() => action("check-now")} disabled={busy === "check-now"} className="rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
          {busy === "check-now" ? "Checking…" : "Check now"}
        </button>
        <button onClick={() => action(w.status === "paused" ? "resume" : "pause")} disabled={busy != null} className="rounded-lg border border-violet-200 px-2 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50">
          {w.status === "paused" ? "Resume" : "Pause"}
        </button>
        <button onClick={() => setEditing(true)} className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-700">Edit</button>
      </div>
    </BlockShell>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  );
}

/* ---- Invoice inbox ------------------------------------------------------- */

interface InvoiceRow {
  id: string;
  vendorName: string;
  payToAddress: string;
  amount: string;
  token: string;
  memo: string | null;
  dueAt: string | null;
  status: "pending" | "queued" | "paid" | "rejected";
}

function InvoiceInboxBlock({ block }: { block: CanvasBlock }) {
  const wallet = asString(block.payload.wallet);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  const [vendorName, setVendorName] = useState("");
  const [payToAddress, setPayToAddress] = useState("");
  const [amount, setAmount] = useState<string>("");
  const [token, setToken] = useState("USDC");
  const [memo, setMemo] = useState("");
  const [dueAt, setDueAt] = useState("");

  const refresh = async () => {
    if (!wallet) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/treasury/invoices?wallet=${wallet}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRows(json.invoices ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load invoices");
    }
    setLoading(false);
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wallet]);

  const submit = async () => {
    setErr(null);
    if (!vendorName || !payToAddress || !(Number(amount) > 0)) { setErr("Vendor, pay-to address and amount are required."); return; }
    setBusy("create");
    try {
      const res = await fetch("/api/treasury/invoices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, vendorName, payToAddress, amount: Number(amount), token, memo: memo || null, dueAt: dueAt || null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setVendorName(""); setPayToAddress(""); setAmount(""); setMemo(""); setDueAt("");
      setShowForm(false);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save invoice");
    }
    setBusy(null);
  };

  const onCsv = async (file: File) => {
    setErr(null); setBulkMsg(null);
    try {
      const text = await readFileAsText(file);
      const { headers, rows: parsed } = parseCsv(text);
      let vIdx = 0, addrIdx = 1, amtIdx = 2, tokIdx = 3, dueIdx = 4, memoIdx = 5;
      if (headers) {
        const find = (re: RegExp) => headers.findIndex((h) => re.test(h));
        const v = find(/vendor|name|payee/i);
        const a = find(/address|wallet|pay.?to|recipient/i);
        const m = find(/amount|value/i);
        const t = find(/token|asset|currency/i);
        const d = find(/due|date/i);
        const me = find(/memo|note|desc/i);
        if (v >= 0) vIdx = v;
        if (a >= 0) addrIdx = a;
        if (m >= 0) amtIdx = m;
        if (t >= 0) tokIdx = t;
        if (d >= 0) dueIdx = d;
        if (me >= 0) memoIdx = me;
      }
      const invoices = parsed
        .map((r) => {
          const vendor = (r[vIdx] ?? "").trim();
          const addr = (r[addrIdx] ?? "").trim();
          const amt = Number(r[amtIdx]);
          const tok = (r[tokIdx] ?? "USDC").trim().toUpperCase() || "USDC";
          const due = (r[dueIdx] ?? "").trim();
          const me = (r[memoIdx] ?? "").trim();
          if (!vendor || !addr || !(amt > 0)) return null;
          return {
            wallet, vendorName: vendor, payToAddress: addr, amount: amt,
            token: tok, memo: me || null,
            dueAt: due ? new Date(due).toISOString() : null,
          };
        })
        .filter(Boolean) as Array<Record<string, unknown>>;
      if (invoices.length === 0) { setErr("No valid invoices found in CSV."); return; }
      setBusy("bulk");
      let ok = 0, failed = 0;
      for (const inv of invoices) {
        try {
          const res = await fetch("/api/treasury/invoices", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(inv),
          });
          if (res.ok) ok++; else failed++;
        } catch { failed++; }
      }
      setBusy(null);
      setBulkMsg(`Imported ${ok}${failed ? ` · ${failed} failed` : ""}`);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to read CSV");
      setBusy(null);
    }
  };

  const action = async (id: string, a: string) => {
    setBusy(id);
    setErr(null);
    try {
      if (a === "delete") {
        await fetch(`/api/treasury/invoices?id=${id}`, { method: "DELETE" });
      } else {
        await fetch("/api/treasury/invoices", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action: a }),
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    }
    setBusy(null); refresh();
  };

  const open = rows.filter((r) => r.status === "pending" || r.status === "queued");

  return (
    <BlockShell block={block} accent="violet">
      {!wallet ? (
        <p className="text-sm text-slate-600">Connect a wallet to track invoices.</p>
      ) : (
        <>
          {(err || bulkMsg) && (
            <p className={`mb-2 rounded-md px-2 py-1 text-[11px] ${err ? "border border-rose-200 bg-rose-50 text-rose-700" : "border border-violet-200 bg-violet-50 text-violet-800"}`}>
              {err ?? bulkMsg}
            </p>
          )}
          {loading && open.length === 0 ? (
            <p className="text-sm text-slate-500">Loading invoices…</p>
          ) : open.length === 0 ? (
            <p className="text-sm text-slate-600">No invoices in your inbox. Add one when a bill comes in — Dreyv batches them by due date.</p>
          ) : (
            <ul className="divide-y divide-violet-100">
              {open.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-slate-900">{r.vendorName}</span>
                      {r.status === "queued" && (
                        <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">In approval</span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-slate-500">
                      {Number(r.amount).toLocaleString()} {r.token}
                      {r.dueAt ? ` · due ${fmtDate(r.dueAt)}` : ""}
                      {r.memo ? ` · ${r.memo}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {r.status === "pending" && (
                      <button onClick={() => action(r.id, "pay")} disabled={busy === r.id}
                        className="rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                        Queue payment
                      </button>
                    )}
                    {r.status === "pending" && (
                      <button onClick={() => action(r.id, "reject")} disabled={busy === r.id}
                        className="rounded-lg border border-violet-200 px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-700">
                        Reject
                      </button>
                    )}
                    <button onClick={() => action(r.id, "delete")} disabled={busy === r.id}
                      className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-400 hover:text-rose-600">×</button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex items-center gap-2">
            {!showForm && (
              <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:text-violet-900">
                + Add invoice
              </button>
            )}
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50">
              {busy === "bulk" ? "Importing…" : "Import CSV"}
              <input
                type="file" accept=".csv,text/csv,text/plain" className="hidden" disabled={busy === "bulk"}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onCsv(f); e.currentTarget.value = ""; }}
              />
            </label>
          </div>
          {showForm && (
            <div className="mt-3 space-y-2 rounded-lg border border-violet-100 bg-violet-50/40 p-3">
              <div className="grid grid-cols-2 gap-2">
                <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Vendor"
                  className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm" />
                <input value={payToAddress} onChange={(e) => setPayToAddress(e.target.value)} placeholder="Pay-to address"
                  className="rounded-md border border-violet-200 bg-white px-2 py-1.5 font-mono text-[12px]" />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount"
                  className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm" />
                <select value={token} onChange={(e) => setToken(e.target.value)}
                  className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm">
                  <option value="USDC">USDC</option>
                  <option value="USDT">USDT</option>
                  <option value="SOL">SOL</option>
                </select>
                <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
                  className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm text-slate-700" />
              </div>
              <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Memo (optional)"
                className="w-full rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm" />
              <div className="flex items-center gap-2">
                <button onClick={submit} disabled={busy === "create"}
                  className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                  {busy === "create" ? "Saving…" : "Save invoice"}
                </button>
                <button onClick={() => { setShowForm(false); setErr(null); }} className="text-xs font-semibold text-slate-500 hover:text-slate-700">Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </BlockShell>
  );
}

/* ---- Phase 7: Yield routing ---------------------------------------------- */

interface YieldRoute {
  id: string;
  token: string;
  venue: string;
  riskBand: "conservative" | "balanced" | "aggressive";
  targetAmount: string;
  minApyBps: number | null;
  status: "draft" | "active" | "paused" | "exited";
  lastApyBps: number | null;
  notes: string | null;
}

const YIELD_VENUES = [
  { id: "kamino", label: "Kamino" },
  { id: "marginfi", label: "MarginFi" },
  { id: "lulo", label: "Lulo" },
  { id: "drift", label: "Drift" },
  { id: "marinade", label: "Marinade" },
];

function YieldRoutingBlock({ block }: { block: CanvasBlock }) {
  const wallet = asString(block.payload.wallet);
  const stableBalance = asNumber(block.payload.stableBalance) ?? 0;
  const [routes, setRoutes] = useState<YieldRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [token, setToken] = useState("USDC");
  const [venue, setVenue] = useState("kamino");
  const [riskBand, setRiskBand] = useState<"conservative" | "balanced" | "aggressive">("conservative");
  const [targetAmount, setTargetAmount] = useState<string>("");
  const [minApy, setMinApy] = useState<string>("");

  const refresh = async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/treasury/yield-routes?wallet=${wallet}`);
      const json = await res.json();
      setRoutes(json.routes ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wallet]);

  const submit = async () => {
    if (!wallet || !venue || !targetAmount) return;
    setBusy("create");
    await fetch("/api/treasury/yield-routes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet, token, venue, riskBand,
        targetAmount: Number(targetAmount),
        minApyBps: minApy ? Math.round(Number(minApy) * 100) : null,
      }),
    });
    setBusy(null); setShowForm(false);
    setTargetAmount(""); setMinApy("");
    refresh();
  };

  const action = async (id: string, a: string) => {
    setBusy(`${id}:${a}`);
    await fetch("/api/treasury/yield-routes", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, wallet, action: a }),
    });
    setBusy(null); refresh();
  };

  const remove = async (id: string) => {
    setBusy(`${id}:del`);
    await fetch(`/api/treasury/yield-routes?id=${id}&wallet=${wallet}`, { method: "DELETE" });
    setBusy(null); refresh();
  };

  if (!wallet) {
    return <BlockShell block={block} accent="slate"><p className="text-sm text-slate-600">Connect a wallet to route idle stables to vetted yield venues.</p></BlockShell>;
  }

  return (
    <BlockShell block={block} accent="violet">
      {loading && routes.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          {routes.length === 0 ? (
            <p className="text-sm text-slate-700">
              {stableBalance > 0
                ? `${stableBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })} in stables sitting idle. Route a slice to a vetted venue — Dreyv keeps it inside your risk band and proposes deploys via HITL.`
                : "Set up a yield route now and it'll activate the moment idle stables land."}
            </p>
          ) : (
            <div className="space-y-1.5">
              {routes.map((r) => {
                const venueLabel = YIELD_VENUES.find((v) => v.id === r.venue)?.label ?? r.venue;
                const tone = r.status === "active" ? "emerald" : r.status === "exited" ? "slate" : r.status === "paused" ? "amber" : "violet";
                return (
                  <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-violet-100 bg-white px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-slate-900">{venueLabel}</span>
                        <span className="text-[12px] text-slate-500">{r.token} · {Number(r.targetAmount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                        <Pill tone={tone === "emerald" ? "emerald" : tone === "amber" ? "amber" : tone === "slate" ? "slate" : "violet"}>{r.status}</Pill>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {r.riskBand} band{r.minApyBps != null ? ` · min ${(r.minApyBps / 100).toFixed(2)}% APY` : ""}
                        {r.lastApyBps != null ? ` · live ${(r.lastApyBps / 100).toFixed(2)}%` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {r.status === "draft" && (
                        <button onClick={() => action(r.id, "deploy")} disabled={busy != null}
                          className="rounded-md bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                          {busy === `${r.id}:deploy` ? "Queueing…" : "Deploy"}
                        </button>
                      )}
                      {r.status === "active" && (
                        <>
                          <button onClick={() => action(r.id, "pause")} disabled={busy != null}
                            className="rounded-md border border-violet-200 px-2 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50">Pause</button>
                          <button onClick={() => action(r.id, "exit")} disabled={busy != null}
                            className="rounded-md border border-rose-200 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50">Exit</button>
                        </>
                      )}
                      {r.status === "paused" && (
                        <button onClick={() => action(r.id, "resume")} disabled={busy != null}
                          className="rounded-md border border-violet-200 px-2 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50">Resume</button>
                      )}
                      <button onClick={() => remove(r.id)} disabled={busy != null}
                        className="rounded-md px-1.5 py-1 text-[11px] text-slate-400 hover:text-rose-600">×</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!showForm ? (
            <button onClick={() => setShowForm(true)} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:text-violet-900">
              + Add yield route
            </button>
          ) : (
            <div className="mt-3 space-y-2 rounded-lg border border-violet-100 bg-violet-50/40 p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <select value={token} onChange={(e) => setToken(e.target.value)}
                  className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm">
                  <option value="USDC">USDC</option>
                  <option value="USDT">USDT</option>
                  <option value="PYUSD">PYUSD</option>
                  <option value="SOL">SOL</option>
                </select>
                <select value={venue} onChange={(e) => setVenue(e.target.value)}
                  className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm">
                  {YIELD_VENUES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
                <select value={riskBand} onChange={(e) => setRiskBand(e.target.value as any)}
                  className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm">
                  <option value="conservative">Conservative</option>
                  <option value="balanced">Balanced</option>
                  <option value="aggressive">Aggressive</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" step="0.01" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)}
                  placeholder="Target amount"
                  className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm" />
                <input type="number" step="0.1" value={minApy} onChange={(e) => setMinApy(e.target.value)}
                  placeholder="Min APY % (optional)"
                  className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm" />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={submit} disabled={busy === "create" || !targetAmount}
                  className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                  {busy === "create" ? "Saving…" : "Save route"}
                </button>
                <button onClick={() => setShowForm(false)} className="text-xs font-semibold text-slate-500 hover:text-slate-700">Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </BlockShell>
  );
}

/* ---- Phase 7: Reports & shareable links ---------------------------------- */

interface TreasuryReport {
  id: string;
  title: string;
  status: "draft" | "published" | "revoked";
  shareToken: string | null;
  shareExpiresAt: string | null;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

function ReportsShareBlock({ block }: { block: CanvasBlock }) {
  const wallet = asString(block.payload.wallet);
  const valuation = asNumber(block.payload.valuation);
  const change24h = asNumber(block.payload.change24h);
  const tokens = asArray<{ symbol?: string; value?: number }>(block.payload.tokens);

  const [reports, setReports] = useState<TreasuryReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/treasury/reports?wallet=${wallet}`);
      const json = await res.json();
      setReports(json.reports ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wallet]);

  const generate = async () => {
    if (!wallet) return;
    setBusy("create");
    const snapshot = {
      valuation, change24h,
      tokens: tokens.map((t) => ({ symbol: t.symbol, value: t.value })),
      generatedAt: new Date().toISOString(),
    };
    await fetch("/api/treasury/reports", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, snapshot }),
    });
    setBusy(null); refresh();
  };

  const publish = async (id: string) => {
    setBusy(`${id}:pub`);
    await fetch("/api/treasury/reports", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, wallet, action: "publish", expiresInDays: 30 }),
    });
    setBusy(null); refresh();
  };

  const revoke = async (id: string) => {
    setBusy(`${id}:rev`);
    await fetch("/api/treasury/reports", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, wallet, action: "revoke" }),
    });
    setBusy(null); refresh();
  };

  const remove = async (id: string) => {
    setBusy(`${id}:del`);
    await fetch(`/api/treasury/reports?id=${id}&wallet=${wallet}`, { method: "DELETE" });
    setBusy(null); refresh();
  };

  const copyLink = async (r: TreasuryReport) => {
    if (!r.shareToken) return;
    const url = `${window.location.origin}/r/${r.shareToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(r.id);
      setTimeout(() => setCopiedId(null), 1600);
    } catch { /* ignore */ }
  };

  if (!wallet) {
    return <BlockShell block={block} accent="slate"><p className="text-sm text-slate-600">Connect a wallet to generate a treasury report.</p></BlockShell>;
  }

  return (
    <BlockShell block={block} accent="violet">
      {loading && reports.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          {reports.length === 0 ? (
            <p className="text-sm text-slate-700">Generate a board-ready snapshot of your treasury — composition, valuation, 24h move — then publish a read-only link for accountants and stakeholders.</p>
          ) : (
            <div className="space-y-1.5">
              {reports.slice(0, 5).map((r) => {
                const isPublished = r.status === "published" && r.shareToken;
                return (
                  <div key={r.id} className="rounded-lg border border-violet-100 bg-white px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-semibold text-slate-900 truncate">{r.title}</span>
                          <Pill tone={isPublished ? "emerald" : r.status === "revoked" ? "slate" : "violet"}>{r.status}</Pill>
                        </div>
                        <div className="text-[11px] text-slate-500">{new Date(r.createdAt).toLocaleString()}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!isPublished && r.status !== "revoked" && (
                          <button onClick={() => publish(r.id)} disabled={busy != null}
                            className="rounded-md bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                            {busy === `${r.id}:pub` ? "…" : "Publish link"}
                          </button>
                        )}
                        {isPublished && (
                          <>
                            <button onClick={() => copyLink(r)}
                              className="rounded-md border border-violet-200 px-2 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50">
                              {copiedId === r.id ? "Copied!" : "Copy link"}
                            </button>
                            <button onClick={() => revoke(r.id)} disabled={busy != null}
                              className="rounded-md border border-rose-200 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50">Revoke</button>
                          </>
                        )}
                        <button onClick={() => remove(r.id)} disabled={busy != null}
                          className="rounded-md px-1.5 py-1 text-[11px] text-slate-400 hover:text-rose-600">×</button>
                      </div>
                    </div>
                    {isPublished && r.shareExpiresAt && (
                      <div className="mt-1 text-[10px] text-slate-500">Expires {new Date(r.shareExpiresAt).toLocaleDateString()}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <button onClick={generate} disabled={busy === "create"}
            className="mt-3 inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
            {busy === "create" ? "Generating…" : "Generate report"}
          </button>
        </>
      )}
    </BlockShell>
  );
}

/* ---- Phase 7: Wallet & Asset Security ------------------------------------ */

interface SecurityAudit {
  id: string;
  score: number;
  findings: { severity: "info" | "warn" | "high"; code: string; message: string }[];
  signers: { address: string; label?: string }[];
  threshold: number | null;
  isMultisig: boolean;
  lastAuditAt: string | null;
}

function WalletSecurityBlock({ block }: { block: CanvasBlock }) {
  const wallet = asString(block.payload.wallet);
  const [audit, setAudit] = useState<SecurityAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/treasury/security?wallet=${wallet}`);
      const json = await res.json();
      setAudit(json.audit);
    } catch { /* ignore */ }
    setLoading(false);
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wallet]);

  const runAudit = async () => {
    setBusy(true);
    await fetch("/api/treasury/security", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet }),
    });
    setBusy(false); refresh();
  };

  if (!wallet) {
    return <BlockShell block={block} accent="slate"><p className="text-sm text-slate-600">Connect a wallet to audit signer hygiene and key security.</p></BlockShell>;
  }

  const scoreTone = audit == null ? "slate" : audit.score >= 80 ? "emerald" : audit.score >= 50 ? "amber" : "rose";

  return (
    <BlockShell block={block} accent={scoreTone === "rose" ? "rose" : "violet"}>
      {loading && !audit ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !audit ? (
        <>
          <p className="text-sm text-slate-700">Run a security audit on this vault — Dreyv inspects signer setup, multisig threshold, and surfaces hygiene findings.</p>
          <button onClick={runAudit} disabled={busy}
            className="mt-3 inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
            {busy ? "Auditing…" : "Run security audit"}
          </button>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight text-slate-900">{audit.score}</span>
              <span className="text-xs text-slate-500">hygiene score · {audit.isMultisig ? `multisig${audit.threshold ? ` ${audit.threshold}/${audit.signers.length}` : ""}` : "single signer"}</span>
            </div>
            <Pill tone={scoreTone === "rose" ? "rose" : scoreTone === "amber" ? "amber" : scoreTone === "emerald" ? "emerald" : "violet"}>
              {audit.score >= 80 ? "Healthy" : audit.score >= 50 ? "Improve" : "At risk"}
            </Pill>
          </div>
          {audit.findings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {audit.findings.slice(0, 4).map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px]">
                  <span className={`mt-1 inline-block h-1.5 w-1.5 flex-none rounded-full ${
                    f.severity === "high" ? "bg-rose-500" : f.severity === "warn" ? "bg-amber-500" : "bg-violet-400"
                  }`} />
                  <span className="text-slate-700">{f.message}</span>
                </li>
              ))}
            </ul>
          )}
          {audit.signers.length > 0 && (
            <div className="mt-2 text-[11px] text-slate-500">
              Signers: {audit.signers.map((s) => s.label ?? `${s.address.slice(0, 4)}…${s.address.slice(-4)}`).join(", ")}
            </div>
          )}
          <div className="mt-3 flex items-center gap-1.5">
            <button onClick={runAudit} disabled={busy}
              className="rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
              {busy ? "Re-auditing…" : "Re-audit"}
            </button>
            {audit.lastAuditAt && (
              <span className="text-[11px] text-slate-400">last {new Date(audit.lastAuditAt).toLocaleString()}</span>
            )}
          </div>
        </>
      )}
    </BlockShell>
  );
}
