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
import { SignalBadge, type Severity } from "@/components/analytics/SignalBadge";
import { DreyvStar } from "@/components/studio/DreyvStar";

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
    <BlockShell block={block} accent="violet">
      <div className="flex items-start gap-3">
        <span className="mt-1 inline-flex shrink-0 items-center justify-center text-violet-600">
          <DreyvStar size={11} />
        </span>
        <div className="min-w-0 flex-1">
          {message ? <ClampedBody text={message} /> : null}
        </div>
      </div>
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
  const series = asArray<number>(block.payload.series);
  const delta = asNumber(block.payload.changePct);
  return (
    <BlockShell block={block} accent="violet">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <DreyvStar size={9} className="text-violet-500" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">{label}</p>
          </div>
          <div className="mt-1.5 font-manrope text-3xl font-semibold tracking-tight text-slate-900">
            <StreamingNumber value={value} prefix={prefix} suffix={suffix} decimals={decimals} />
          </div>
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        {(series.length > 1 || delta != null) && (
          <div className="flex flex-col items-end gap-1.5">
            {series.length > 1 && <MiniSpark values={series} className="h-10 w-28" />}
            {delta != null && (
              <SignalBadge severity={delta >= 0 ? "good" : "watch"}>
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
              </SignalBadge>
            )}
          </div>
        )}
      </div>
    </BlockShell>
  );
}

/** Compact violet sparkline used inside metric/result cards. */
function MiniSpark({ values, className = "h-8 w-24" }: { values: number[]; className?: string }) {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 100;
  const h = 32;
  const step = w / Math.max(1, values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(2)},${(h - ((v - min) / span) * h).toFixed(2)}`).join(" ");
  const last = values[values.length - 1];
  const lx = w;
  const ly = h - ((last - min) / span) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="msfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${points} ${w},${h}`} fill="url(#msfill)" />
      <polyline points={points} fill="none" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2" fill="#7c3aed" />
    </svg>
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
        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white motion-safe:animate-pulse">
          <DreyvStar size={9} className="text-white" />
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
          <SignalBadge severity={status === "complete" || status === "success" ? "good" : status === "running" || status === "streaming" ? "neutral" : "neutral"}>
            {status}
          </SignalBadge>
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
  const triggered = status === "triggered" || status === "fired";
  return (
    <BlockShell block={block} accent="violet">
      <div className="flex items-start gap-3">
        <span className="relative mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700">
          <DreyvStar size={11} />
          {!triggered && (
            <span className="absolute inset-0 rounded-xl border border-violet-300 motion-safe:animate-ping opacity-60" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">Watcher · {status}</p>
          <p className="mt-1 text-sm text-slate-700">{condition || "Conditions configured."}</p>
        </div>
        <SignalBadge severity={triggered ? "risk" : "good"}>{triggered ? "fired" : "live"}</SignalBadge>
      </div>
    </BlockShell>
  );
}

function DecisionBlock({ block }: { block: CanvasBlock }) {
  const choices = asArray<{ label?: string; href?: string; tone?: "primary" | "ghost" }>(block.payload.choices);
  const rationale = asString(block.payload.rationale);
  return (
    <BlockShell block={block} accent="violet">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-white text-violet-700">
          <DreyvStar size={11} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">Decision needed</p>
          {rationale && <p className="mt-1 text-sm leading-relaxed text-slate-700">{rationale}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {choices.map((c, i) => {
              const ghost = c.tone === "ghost" || i > 0;
              const cls = ghost
                ? "rounded-xl border border-violet-200 bg-white px-3.5 py-1.5 text-[12px] font-semibold text-violet-700 hover:bg-violet-50"
                : "rounded-xl bg-violet-600 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-700";
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
        </div>
      </div>
    </BlockShell>
  );
}

function CapabilityResultBlock({ block }: { block: CanvasBlock }) {
  const operation = asString(block.payload.operation);
  const success = block.payload.success !== false;
  const message = asString(block.payload.message ?? block.payload.summary);
  return (
    <BlockShell block={block} accent="violet">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border ${
            success ? "border-violet-200 bg-violet-50 text-violet-700" : "border-slate-900 bg-slate-900 text-violet-200"
          }`}
        >
          {success ? <DreyvStar size={11} /> : <GlyphAlert className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            {operation && (
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                {operation}
              </p>
            )}
            <SignalBadge severity={success ? "good" : "risk"}>{success ? "complete" : "failed"}</SignalBadge>
          </div>
          {message && <div className="mt-1.5"><ClampedBody text={message} /></div>}
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
        <span className="relative mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white">
          <DreyvStar size={11} className="text-white" />
          <span className="pointer-events-none absolute -inset-1 rounded-2xl border border-violet-300 opacity-50 motion-safe:animate-pulse" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">Dreyv suggests</p>
          {typeof block.payload.message === "string" && block.payload.message && (
            <p className="mt-1 text-sm leading-relaxed text-slate-700">{asString(block.payload.message)}</p>
          )}
          {cta?.href && (
            <Link
              href={cta.href}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-700"
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
  const [expanded, setExpanded] = useState(false);
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
          <div className="hidden grid-cols-[1.6fr_1fr_1fr_0.7fr_180px] gap-3 bg-violet-50/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 md:grid">
            <span>Asset</span>
            <span className="text-right">Balance</span>
            <span className="text-right">Value</span>
            <span className="text-right">24h</span>
            <span className="text-right">Actions</span>
          </div>
          <ul className="divide-y divide-violet-100/70">
            {visibleRows.map((r) => {
              const tone = (r.change24h ?? 0) >= 0 ? "text-violet-700" : "text-slate-900";
              return (
                <li key={r.symbol} className="grid grid-cols-2 items-center gap-2 px-4 py-2 text-sm md:grid-cols-[1.6fr_1fr_1fr_0.7fr_180px] md:gap-3">
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
function RosterConstellation({
  vaults,
  activeAddress,
}: {
  vaults: Array<{ address: string; label?: string; kind?: string }>;
  activeAddress: string | null;
}) {
  // Org chart: a "Treasury" hub on the left, wallet chips fanned out to the
  // right via soft violet sinew lines. Sized so labels never clip and the
  // active wallet stays legible (no full violet wash that hides the address).
  const W = 420;
  const rowH = 34;
  const padTop = 10;
  const padBottom = 10;
  const H = Math.max(92, padTop + padBottom + Math.max(vaults.length, 1) * rowH);
  const coreX = 52;
  const coreY = H / 2;
  const coreR = 28;
  const chipX = 138;
  const chipW = 268;
  const chipH = 28;

  const truncate = (s: string, h = 4, t = 4) =>
    s.length <= h + t + 1 ? s : `${s.slice(0, h)}…${s.slice(-t)}`;

  const kindStyle = (kind?: string, isActive?: boolean) => {
    if (kind === "multisig")
      return { fill: "#faf5ff", stroke: "#a78bfa", tagBg: "#ede9fe", tagFg: "#6d28d9", label: "MULTISIG" };
    if (kind === "watch")
      return { fill: "#ffffff", stroke: "#e2e8f0", tagBg: "#f1f5f9", tagFg: "#475569", label: "WATCH" };
    return {
      fill: isActive ? "#f5f3ff" : "#ffffff",
      stroke: isActive ? "#7c3aed" : "#ddd6fe",
      tagBg: "#7c3aed",
      tagFg: "#ffffff",
      label: "SIGNER",
    };
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mx-auto h-auto w-full max-w-[460px]"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Wallet and signers graph"
    >
      <defs>
        <radialGradient id="roster-core-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Core: the Treasury hub */}
      <circle cx={coreX} cy={coreY} r={coreR + 12} fill="url(#roster-core-glow)" />
      <circle cx={coreX} cy={coreY} r={coreR} fill="#0f172a" />
      <circle cx={coreX} cy={coreY} r={coreR} fill="none" stroke="#7c3aed" strokeOpacity="0.4" />
      {/* Dreyv mark inside core */}
      <g transform={`translate(${coreX} ${coreY - 8})`}>
        <path
          d="M0,-6 L1.5,-1.5 L6,0 L1.5,1.5 L0,6 L-1.5,1.5 L-6,0 L-1.5,-1.5 Z"
          fill="#a78bfa"
        />
      </g>
      <text x={coreX} y={coreY + 5} textAnchor="middle" fill="#ffffff" fontSize="7" fontWeight="700" letterSpacing="1.3">
        TREASURY
      </text>
      <text x={coreX} y={coreY + 14} textAnchor="middle" fill="#a78bfa" fontSize="6" letterSpacing="0.7">
        {vaults.length} {vaults.length === 1 ? "WALLET" : "WALLETS"}
      </text>

      {/* Wallet chips + sinew lines */}
      {vaults.map((v, i) => {
        const y = padTop + i * rowH + rowH / 2;
        const isActive = v.address === activeAddress;
        const s = kindStyle(v.kind, isActive);
        const startX = coreX + coreR;
        const endX = chipX;
        const midX = (startX + endX) / 2;
        const path = `M${startX},${coreY} C${midX},${coreY} ${midX},${y} ${endX},${y}`;
        const tagW = s.label.length * 6 + 14;
        const tagX = chipX + chipW - tagW - 10;

        return (
          <g key={v.address}>
            <path
              d={path}
              fill="none"
              stroke={isActive ? "#7c3aed" : "#ede9fe"}
              strokeWidth={isActive ? 1.8 : 1.2}
            />
            <rect
              x={chipX}
              y={y - chipH / 2}
              width={chipW}
              height={chipH}
              rx={10}
              fill={s.fill}
              stroke={s.stroke}
              strokeWidth={isActive ? 1.6 : 1}
            />
            <text x={chipX + 12} y={y - 3} fontSize="10.5" fontWeight="700" fill="#0f172a">
              {truncate(v.label ?? v.address, 16, 0)}
            </text>
            <text x={chipX + 12} y={y + 9} fontSize="8.5" fill="#64748b" letterSpacing="0.3" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
              {truncate(v.address, 5, 5)}
            </text>
            {/* Role tag */}
            <rect x={tagX} y={y - 7} width={tagW} height={14} rx={7} fill={s.tagBg} />
            <text
              x={tagX + tagW / 2}
              y={y + 3}
              textAnchor="middle"
              fontSize="8"
              fontWeight="700"
              letterSpacing="0.8"
              fill={s.tagFg}
            >
              {s.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

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

  // Roster composition for the mini-visual
  const counts = registeredVaults.reduce(
    (acc, v) => {
      const k = (v.kind ?? "connected") as "connected" | "watch" | "multisig";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    },
    { connected: 0, watch: 0, multisig: 0 } as Record<"connected" | "watch" | "multisig", number>,
  );

  return (
    <BlockShell block={block} accent="violet">
      {/* Roster constellation — a bespoke visual of the signer set */}
      {registeredVaults.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-2xl border border-violet-100 bg-white px-3 py-3">
          <RosterConstellation vaults={registeredVaults} activeAddress={activeVault ?? null} />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {counts.connected > 0 && (
              <SignalBadge severity="good" showStar={false}>{counts.connected} connected</SignalBadge>
            )}
            {counts.multisig > 0 && (
              <SignalBadge severity="neutral" showStar={false}>{counts.multisig} multisig</SignalBadge>
            )}
            {counts.watch > 0 && (
              <SignalBadge severity="neutral" showStar={false}>{counts.watch} watch-only</SignalBadge>
            )}
          </div>
        </div>
      )}

      {/* Header strip — count + tier + add actions */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-slate-500">
          <DreyvStar size={9} className="text-violet-500" />
          {registeredVaults.length} {registeredVaults.length === 1 ? "wallet" : "wallets"}
          {tierLimit && (
            <SignalBadge severity={limitReached ? "watch" : "neutral"} showStar={false}>
              {tierLimit.used}/{tierLimit.limit} · {tierLimit.tier}
            </SignalBadge>
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
                  className="shrink-0"
                  aria-label={isActive ? "Active" : "Set active"}
                >
                  <DreyvStar size={11} className={isActive ? "text-violet-600" : "text-slate-300 hover:text-violet-400"} />
                </button>
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
                    <SignalBadge
                      severity={w.kind === "multisig" ? "neutral" : w.kind === "watch" ? "neutral" : "good"}
                      showStar={false}
                    >
                      {w.kind}
                    </SignalBadge>
                  </p>
                </div>
                {isActive && (
                  <SignalBadge severity="neutral" showStar={false}>active</SignalBadge>
                )}
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
    const reason = sample === 0
      ? "No outflows watched yet. Dreyv will fill in runway as soon as it sees a few outflows — or you can log them via the events API."
      : burnUsable
        ? "No stable balance to draw from yet. Top up USDC or USDT and runway will appear."
        : "Burn rate is effectively zero right now, so runway is unbounded at current pace.";
    return (
      <BlockShell block={block} accent="violet">
        <div className="grid gap-5 sm:grid-cols-[150px_1fr] sm:items-center">
          <RunwayEmptyArt />
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">Runway</p>
              <SignalBadge severity="neutral">awaiting data</SignalBadge>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{reason}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <SignalBadge severity="neutral" showStar={false}>90-day window</SignalBadge>
              <SignalBadge severity="neutral" showStar={false}>auto-fills</SignalBadge>
              <SignalBadge severity="neutral" showStar={false}>stables-aware</SignalBadge>
            </div>
          </div>
        </div>
      </BlockShell>
    );
  }

  const severity = months >= 18 ? "good" : months >= 9 ? "neutral" : months >= 6 ? "watch" : "risk";
  const verdict = months >= 18 ? "Healthy" : months >= 9 ? "Comfortable" : months >= 6 ? "Tight" : "Critical";

  // Arc gauge — clamp 0..36 months range; healthy threshold at 18m.
  const HORIZON = 36;
  const clamped = Math.max(0, Math.min(months, HORIZON));
  const t = clamped / HORIZON;
  const R = 64;
  const CX = 80;
  const CY = 80;
  const arcLen = Math.PI * R; // half-circle
  const dash = arcLen * t;
  const angle = -Math.PI + Math.PI * t;
  const needleX = CX + R * Math.cos(angle);
  const needleY = CY + R * Math.sin(angle);
  const arcColor = severity === "good" ? "#7c3aed" : severity === "neutral" ? "#8b5cf6" : severity === "watch" ? "#a78bfa" : "#5b21b6";

  return (
    <BlockShell block={block} accent="violet">
      <div className="grid gap-5 sm:grid-cols-[160px_1fr] sm:items-center">
        {/* Half-donut runway gauge */}
        <div className="relative mx-auto" style={{ width: 160, height: 96 }}>
          <svg viewBox="0 0 160 96" className="h-24 w-40">
            {/* Track */}
            <path d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`} stroke="#f5f3ff" strokeWidth={12} fill="none" strokeLinecap="round" />
            {/* Milestones at 6 / 12 / 18 / 24 mo */}
            {[6, 12, 18, 24].map((m) => {
              const a = -Math.PI + Math.PI * (m / HORIZON);
              const x1 = CX + (R - 8) * Math.cos(a);
              const y1 = CY + (R - 8) * Math.sin(a);
              const x2 = CX + (R + 4) * Math.cos(a);
              const y2 = CY + (R + 4) * Math.sin(a);
              return <line key={m} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ddd6fe" strokeWidth={1.5} strokeLinecap="round" />;
            })}
            {/* Filled arc */}
            <path
              d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
              stroke={arcColor}
              strokeWidth={12}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${arcLen}`}
            />
            {/* Needle */}
            <line x1={CX} y1={CY} x2={needleX} y2={needleY} stroke="#0f172a" strokeWidth={2} strokeLinecap="round" />
            <circle cx={CX} cy={CY} r={4} fill="#0f172a" />
          </svg>
          <div className="absolute inset-x-0 bottom-0 text-center">
            <div className="font-manrope text-2xl font-semibold leading-none tracking-tight text-slate-900 tabular-nums">
              {months.toFixed(1)}
              <span className="ml-1 text-xs font-medium text-slate-500">mo</span>
            </div>
          </div>
        </div>

        {/* Right column — numbers + signal */}
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">Runway</p>
            <SignalBadge severity={severity}>{verdict}</SignalBadge>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <RunwayStat label="Stables" value={fmtUsd(stableBalance, 0)} />
            <RunwayStat label="Burn / mo" value={burn != null ? fmtUsd(burn, 0) : "—"} />
            <RunwayStat label="Inflow / mo" value={inflow != null ? fmtUsd(inflow, 0) : "—"} accent />
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-violet-50">
            <div className="h-full rounded-full bg-violet-600" style={{ width: `${t * 100}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            <span>0</span><span>6</span><span>12</span><span>18</span><span>24</span><span>36+</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            From {sample} event{sample === 1 ? "" : "s"} over 90 days
          </p>
        </div>
      </div>
    </BlockShell>
  );
}

/** Bespoke runway empty-state illustration: hourglass-meets-arc. */
function RunwayEmptyArt() {
  return (
    <svg viewBox="0 0 150 110" className="mx-auto h-24 w-36" aria-hidden>
      <defs>
        <linearGradient id="rwfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Track arc */}
      <path d="M 18 78 A 57 57 0 0 1 132 78" stroke="#ede9fe" strokeWidth="10" fill="none" strokeLinecap="round" />
      {/* Ghost progress */}
      <path d="M 18 78 A 57 57 0 0 1 75 21" stroke="#c4b5fd" strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray="3 6" opacity="0.7" />
      {/* Tick marks */}
      {[0.16, 0.33, 0.5, 0.66, 0.83].map((p, i) => {
        const a = -Math.PI + Math.PI * p;
        const x1 = 75 + 49 * Math.cos(a);
        const y1 = 78 + 49 * Math.sin(a);
        const x2 = 75 + 65 * Math.cos(a);
        const y2 = 78 + 65 * Math.sin(a);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ddd6fe" strokeWidth="1.5" strokeLinecap="round" />;
      })}
      {/* Hub + star */}
      <circle cx="75" cy="78" r="9" fill="#fff" stroke="#7c3aed" strokeWidth="1.5" />
      <path d="M75 71 L76.5 76 L81.5 78 L76.5 80 L75 85 L73.5 80 L68.5 78 L73.5 76 Z" fill="#7c3aed" />
      {/* Filled wedge hint */}
      <path d="M 75 78 L 18 78 A 57 57 0 0 1 30 41 Z" fill="url(#rwfill)" />
    </svg>
  );
}

function RunwayStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border px-2.5 py-2 ${accent ? "border-violet-200 bg-violet-50/60" : "border-violet-100 bg-white"}`}>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 font-manrope text-sm font-semibold tracking-tight text-slate-900 tabular-nums">{value}</div>
    </div>
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

interface WalletToken {
  mint: string;
  symbol: string;
  name?: string;
  decimals?: number;
  balance?: string;
}

function MassSendBlock({ block }: { block: CanvasBlock }) {
  const wallet = asString(block.payload.wallet);
  const isMultisig = block.payload.isMultisig === true;
  const [defaultToken, setDefaultToken] = useState<string>(asString(block.payload.defaultToken, "USDC"));
  const [walletTokens, setWalletTokens] = useState<WalletToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [showTokenMenu, setShowTokenMenu] = useState(false);
  const [tokenQuery, setTokenQuery] = useState("");

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    setTokensLoading(true);
    fetch(`/api/helius/das/wallet-holdings?address=${wallet}&limit=100`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const list: WalletToken[] = Array.isArray(d?.holdings) ? d.holdings : [];
        setWalletTokens(list);
      })
      .catch(() => { /* keep fallbacks */ })
      .finally(() => { if (!cancelled) setTokensLoading(false); });
    return () => { cancelled = true; };
  }, [wallet]);
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

  // Risk tier for the batch (replaces emerald/rose)
  const batchSeverity: Severity =
    totalAmount > 10_000 ? "risk" : totalAmount > 1_000 ? "watch" : valid.length > 0 ? "good" : "neutral";
  const tokenSet = useMemo(() => Array.from(new Set(valid.map((r) => r.token).filter(Boolean))), [valid]);

  return (
    <BlockShell block={block} accent="violet">
      <div className="space-y-4">
        {/* Header summary + fan-out visualization */}
        <div className="grid gap-4 sm:grid-cols-[180px_1fr] sm:items-center">
          <FanOutGraph count={valid.length} />
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
                {totalAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">{defaultToken}</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Batch payout · {valid.length} recipient{valid.length === 1 ? "" : "s"}
              {invalidCount > 0 && <span className="text-slate-400"> · {invalidCount} skipped</span>}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <SignalBadge severity={batchSeverity}>
                {totalAmount > 10_000 ? "High value" : totalAmount > 1_000 ? "Medium" : valid.length > 0 ? "Low value" : "Empty"}
              </SignalBadge>
              {isMultisig && <SignalBadge severity="neutral">Squads multisig</SignalBadge>}
              {tokenSet.length > 1 && <SignalBadge severity="watch">{tokenSet.length} tokens</SignalBadge>}
              {invalidCount > 0 && <SignalBadge severity="risk">{invalidCount} invalid</SignalBadge>}
            </div>
          </div>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={`relative rounded-2xl border-2 border-dashed px-3 py-3 text-center transition-colors ${
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
            address · amount · token · label — auto-detected & validated
          </p>
          {activeFileName && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-mono text-violet-700">
              <DreyvStar size={9} className="text-violet-500" /> {activeFileName}
            </p>
          )}
        </div>

        {showSaved && savedFiles.length > 0 && (
          <div className="rounded-xl border border-violet-100 bg-white">
            <ul className="max-h-32 divide-y divide-violet-100/70 overflow-y-auto">
              {savedFiles.slice(0, 10).map((f) => (
                <li key={f.id} className="flex items-center justify-between px-3 py-1.5 text-[12px]">
                  <button onClick={() => loadSaved(f.id)} className="flex-1 text-left hover:text-violet-700">
                    <span className="font-medium text-slate-800">{f.name}</span>
                    <span className="ml-2 text-[10px] text-slate-500">
                      {f.recipientCount} · {f.totalAmount.toLocaleString()} {f.tokenSummary}
                    </span>
                  </button>
                  <button
                    onClick={() => deleteFile(f.id)}
                    className="text-[10px] text-slate-400 hover:text-violet-600"
                    aria-label="Delete saved file"
                  >✕</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {parseErrors.length > 0 && (
          <div className="rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2 text-[11px] text-violet-900">
            <p className="mb-1 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-700">
              <DreyvStar size={9} className="text-violet-500" /> Parser notes
            </p>
            {parseErrors.map((e, i) => <div key={i} className="flex gap-1.5"><DreyvStar size={8} className="mt-1 shrink-0 text-violet-400" />{e}</div>)}
          </div>
        )}

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
                    <span className="flex min-w-0 items-center gap-1.5 truncate font-mono text-slate-700">
                      <DreyvStar size={8} className={r.error ? "text-violet-300" : "text-violet-500"} />
                      {r.address ? `${r.address.slice(0,4)}…${r.address.slice(-4)}` : "—"}
                    </span>
                    <span className="text-right tabular-nums text-slate-900">{Number.isFinite(r.amount) ? r.amount.toLocaleString() : "—"}</span>
                    <span className="text-slate-600">{r.token}</span>
                    <span className="flex justify-end">
                      <SignalBadge severity={r.error ? "risk" : "good"}>{r.error ?? "ok"}</SignalBadge>
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
              <Link href="/app/inbox" className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 hover:text-violet-900">
                <DreyvStar size={9} className="text-violet-500" /> Queued — open inbox
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

/** Fan-out distribution SVG: one violet source → up to 12 ray endpoints scaled to recipient count. */
function FanOutGraph({ count }: { count: number }) {
  const shown = Math.min(Math.max(count, 0), 12);
  const rays = Array.from({ length: 12 }, (_, i) => {
    const angle = (Math.PI * (i + 0.5)) / 12 - Math.PI / 2; // -90deg..+90deg fan
    const r = 70;
    const x = 90 + Math.cos(angle) * r;
    const y = 80 + Math.sin(angle) * r;
    const active = i < shown;
    return { x, y, active };
  });
  return (
    <svg viewBox="0 0 180 110" className="h-[110px] w-full" role="img" aria-label="Mass send fan-out">
      <defs>
        <radialGradient id="msHub" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="80" r="22" fill="url(#msHub)" />
      {rays.map((r, i) => (
        <line
          key={i}
          x1={20} y1={80} x2={r.x} y2={r.y}
          stroke={r.active ? "#7c3aed" : "#ede9fe"}
          strokeWidth={r.active ? 1.2 : 1}
          strokeDasharray={r.active ? "0" : "2 3"}
        />
      ))}
      {rays.map((r, i) => (
        <circle
          key={`d-${i}`}
          cx={r.x} cy={r.y}
          r={r.active ? 3 : 2}
          fill={r.active ? "#7c3aed" : "#fff"}
          stroke={r.active ? "#7c3aed" : "#c4b5fd"}
          strokeWidth={1}
        />
      ))}
      <circle cx="20" cy="80" r="9" fill="#7c3aed" />
      <text x="20" y="83" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff">$</text>
      <text x="92" y="14" textAnchor="middle" fontSize="9" fontWeight="600" fill="#7c3aed" letterSpacing="1.2">
        {count} RECIPIENTS
      </text>
    </svg>
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
      <div className="space-y-4">
        {/* Header — guardrails ladder + status */}
        <div className="grid gap-4 sm:grid-cols-[180px_1fr] sm:items-center">
          <GuardrailsLadder
            autoApprove={policy.autoApproveBelowUsd}
            multisig={policy.requireMultisigAboveUsd}
            cap={policy.dailyValueCapUsd}
          />
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
                {pendingTotal}
              </span>
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
                {pendingTotal === 1 ? "item awaits you" : "items await you"}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <SignalBadge severity={pendingTotal > 0 ? "watch" : "good"}>
                {pendingTotal > 0 ? `${pendingTotal} pending` : "All clear"}
              </SignalBadge>
              <SignalBadge severity="neutral">auto ≤ {fmtUsd(policy.autoApproveBelowUsd, 0)}</SignalBadge>
              {policy.requireMultisigAboveUsd != null && (
                <SignalBadge severity="neutral">multisig &gt; {fmtUsd(policy.requireMultisigAboveUsd, 0)}</SignalBadge>
              )}
              {policy.dailyValueCapUsd != null && (
                <SignalBadge severity="watch">cap {fmtUsd(policy.dailyValueCapUsd, 0)}/d</SignalBadge>
              )}
              {policy.allowDynamicWrites && <SignalBadge severity="risk">dynamic writes on</SignalBadge>}
            </div>
            {loading && <span className="text-[10px] uppercase tracking-wider text-slate-400">syncing…</span>}
          </div>
        </div>

        {/* Pending tx queue (HITL signs) */}
        {txQueue.length > 0 && (
          <div className="rounded-xl border border-violet-100">
            <div className="flex items-center justify-between bg-violet-50/60 px-3 py-1.5">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <DreyvStar size={9} className="text-violet-500" /> Pending signatures
              </span>
              <Link href="/app/inbox" className="text-[10px] font-semibold uppercase tracking-wider text-violet-700 hover:text-violet-900">Open inbox →</Link>
            </div>
            <ul className="divide-y divide-violet-100/70">
              {txQueue.slice(0, 3).map((t) => {
                const riskSev: Severity =
                  t.riskLevel === "high" ? "risk" : t.riskLevel === "medium" ? "watch" : "good";
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]">
                    <span className="min-w-0 truncate text-slate-800">{t.summary}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <SignalBadge severity="neutral">{t.routing ?? "wallet"}</SignalBadge>
                      <SignalBadge severity={riskSev}>{t.riskLevel ?? "low"}</SignalBadge>
                    </span>
                  </li>
                );
              })}
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
                const riskNum = typeof a.riskScore === "string" ? Number(a.riskScore) : a.riskScore ?? null;
                const riskSev: Severity = riskNum == null ? "neutral" : riskNum >= 0.66 ? "risk" : riskNum >= 0.33 ? "watch" : "good";
                return (
                  <li key={a.id} className="px-3 py-2 text-[12.5px]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate font-semibold text-slate-900">
                          <DreyvStar size={9} className="text-violet-500" />
                          {a.plan?.summary || a.reason || "Plan"}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {value != null && <SignalBadge severity="neutral">{fmtUsd(value, 0)}</SignalBadge>}
                          {riskNum != null && <SignalBadge severity={riskSev}>risk {riskNum.toFixed(2)}</SignalBadge>}
                        </div>
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
          <p className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <DreyvStar size={9} className="text-violet-500" /> Guardrails
          </p>
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

/** Three-tier value ladder: auto / multisig / cap thresholds on a log-ish scale. */
function GuardrailsLadder({
  autoApprove,
  multisig,
  cap,
}: {
  autoApprove: number;
  multisig: number | null;
  cap: number | null;
}) {
  const max = Math.max(autoApprove || 0, multisig || 0, cap || 0, 10_000);
  const scale = (v: number) => {
    if (v <= 0) return 0;
    return Math.min(1, Math.log10(v + 1) / Math.log10(max + 1));
  };
  const tiers: Array<{ key: string; label: string; v: number | null; tone: string }> = [
    { key: "auto", label: "Auto", v: autoApprove || null, tone: "#a78bfa" },
    { key: "ms", label: "Multisig", v: multisig, tone: "#7c3aed" },
    { key: "cap", label: "Cap/day", v: cap, tone: "#4c1d95" },
  ];
  const fmtShort = (v: number) =>
    v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}m` :
    v >= 1_000 ? `$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k` : `$${v}`;
  return (
    <svg viewBox="0 0 180 110" className="h-[110px] w-full" role="img" aria-label="Guardrails ladder">
      <defs>
        <linearGradient id="ladderTrack" x1="0" x2="1">
          <stop offset="0" stopColor="#ede9fe" />
          <stop offset="1" stopColor="#c4b5fd" />
        </linearGradient>
      </defs>
      {tiers.map((t, i) => {
        const y = 22 + i * 28;
        const w = t.v != null ? 8 + scale(t.v) * 130 : 8;
        return (
          <g key={t.key}>
            <text x="6" y={y - 6} fontSize="8" fontWeight="700" fill="#64748b" letterSpacing="1">
              {t.label.toUpperCase()}
            </text>
            <rect x="6" y={y} width="150" height="6" rx="3" fill="url(#ladderTrack)" opacity="0.4" />
            <rect x="6" y={y} width={w} height="6" rx="3" fill={t.tone} />
            <circle cx={6 + w} cy={y + 3} r="4" fill="#fff" stroke={t.tone} strokeWidth="1.6" />
            <text x="174" y={y + 5} textAnchor="end" fontSize="8" fontWeight="600" fill="#475569">
              {t.v != null ? fmtShort(t.v) : "—"}
            </text>
          </g>
        );
      })}
    </svg>
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

  // Aggregate stats across active schedules
  const totals = active.reduce(
    (acc, s) => {
      const sum = s.recipients.reduce((a, r) => a + r.amount, 0);
      acc.amount += sum;
      acc.recipients += s.recipients.length;
      acc.tokens.add(s.defaultToken);
      return acc;
    },
    { amount: 0, recipients: 0, tokens: new Set<string>() },
  );
  const nextDate = active
    .map((s) => (s.nextRunAt ? new Date(s.nextRunAt).getTime() : null))
    .filter((t): t is number => t != null && !Number.isNaN(t))
    .sort((a, b) => a - b)[0];
  const cadenceMix = active.reduce<Record<string, number>>((acc, s) => {
    acc[s.cadence] = (acc[s.cadence] || 0) + 1;
    return acc;
  }, {});

  return (
    <BlockShell block={block} accent="violet">
      {!wallet ? (
        <p className="text-sm text-slate-600">Connect a wallet to schedule recurring payouts.</p>
      ) : (
        <div className="space-y-4">
          {/* Header — payroll calendar + summary */}
          <div className="grid gap-4 sm:grid-cols-[180px_1fr] sm:items-center">
            <PayoutCalendar nextDate={nextDate ?? null} count={active.length} />
            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-display text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
                  {totals.amount > 0 ? totals.amount.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                </span>
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
                  {totals.tokens.size === 1 ? Array.from(totals.tokens)[0] : `${totals.tokens.size} tokens`}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                {active.length} active schedule{active.length === 1 ? "" : "s"} · {totals.recipients} recipients
              </p>
              <div className="flex flex-wrap gap-1.5">
                {active.length === 0 ? (
                  <SignalBadge severity="neutral">No schedules yet</SignalBadge>
                ) : (
                  <>
                    {Object.entries(cadenceMix).map(([cad, n]) => (
                      <SignalBadge key={cad} severity="neutral">{n} {cad}</SignalBadge>
                    ))}
                    {nextDate && (
                      <SignalBadge severity="good">next {fmtDate(new Date(nextDate).toISOString())}</SignalBadge>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {err && !showForm && (
            <p className="rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2 text-[11px] text-violet-900">{err}</p>
          )}

          {loading && active.length === 0 ? (
            <p className="text-sm text-slate-500">Loading schedules…</p>
          ) : active.length === 0 ? (
            <div className="grid gap-5 rounded-2xl border border-violet-100 bg-violet-50/30 p-4 sm:grid-cols-[150px_1fr] sm:items-center">
              <ScheduleEmptyArt />
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">Set up your first cadence</p>
                <p className="text-[13px] text-slate-700">Payroll, grants, contributors — on a schedule, with one-tap approval.</p>
                <div className="flex flex-wrap gap-1.5">
                  <SignalBadge severity="neutral">Monthly</SignalBadge>
                  <SignalBadge severity="neutral">Biweekly</SignalBadge>
                  <SignalBadge severity="neutral">Weekly</SignalBadge>
                  <SignalBadge severity="neutral">CSV import</SignalBadge>
                </div>
              </div>
            </div>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-violet-100 bg-white">
              {active.map((s, i) => {
                const total = s.recipients.reduce((sum, r) => sum + r.amount, 0);
                return (
                  <li
                    key={s.id}
                    className={`flex items-center justify-between gap-3 px-3 py-3 text-sm ${i > 0 ? "border-t border-violet-100" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <DreyvStar size={10} className="text-violet-500" />
                        <span className="truncate font-semibold text-slate-900">{s.label}</span>
                        <SignalBadge severity="neutral">{s.cadence}</SignalBadge>
                        {s.status === "paused" && <SignalBadge severity="watch">paused</SignalBadge>}
                      </div>
                      <p className="mt-1 text-[12px] text-slate-500">
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
                        className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-400 hover:text-violet-700"
                        aria-label="Archive schedule"
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
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 hover:text-violet-900"
            >
              <DreyvStar size={10} className="text-violet-500" /> New schedule
            </button>
          ) : (
            <div className="space-y-2 rounded-2xl border border-violet-100 bg-violet-50/40 p-3">
              <div className="grid grid-cols-2 gap-2">
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Engineering payroll"
                  className="rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none" />
                <select value={cadence} onChange={(e) => setCadence(e.target.value)}
                  className="rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-sm text-slate-900">
                  <option value="monthly">Monthly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="weekly">Weekly</option>
                  <option value="manual">Manual only</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" min={1} max={28} value={anchorDay} onChange={(e) => setAnchorDay(Number(e.target.value))}
                  placeholder="Day of month" className="rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-sm text-slate-900" />
                <select value={defaultToken} onChange={(e) => setDefaultToken(e.target.value)}
                  className="rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-sm text-slate-900">
                  <option value="USDC">USDC</option>
                  <option value="USDT">USDT</option>
                  <option value="SOL">SOL</option>
                </select>
              </div>
              <textarea
                value={recipientsRaw} onChange={(e) => setRecipientsRaw(e.target.value)}
                rows={3}
                placeholder="address,amount,label per line"
                className="w-full rounded-lg border border-violet-200 bg-white px-2 py-1.5 font-mono text-[12px] text-slate-900 placeholder:text-slate-400"
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
              {err && <p className="rounded-lg border border-violet-200 bg-violet-50/60 px-2 py-1 text-[11px] text-violet-900">{err}</p>}
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
        </div>
      )}
    </BlockShell>
  );
}

/** Mini month-grid calendar with the next run-date highlighted in violet. */
function PayoutCalendar({ nextDate, count }: { nextDate: number | null; count: number }) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const next = nextDate ? new Date(nextDate) : null;
  const nextDay =
    next && next.getFullYear() === year && next.getMonth() === month ? next.getDate() : null;
  const todayDay = today.getDate();

  const cells: Array<number | null> = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows = Math.ceil(cells.length / 7);

  return (
    <svg viewBox="0 0 180 110" className="h-[110px] w-full" role="img" aria-label="Payout calendar">
      <text x="6" y="10" fontSize="8" fontWeight="700" fill="#7c3aed" letterSpacing="1.2">
        {today.toLocaleString(undefined, { month: "short" }).toUpperCase()} · {count} ACTIVE
      </text>
      {Array.from({ length: 7 }).map((_, i) => (
        <text key={i} x={10 + i * 24} y="22" fontSize="7" fontWeight="700" fill="#94a3b8" textAnchor="middle">
          {["S", "M", "T", "W", "T", "F", "S"][i]}
        </text>
      ))}
      {cells.map((d, i) => {
        const col = i % 7;
        const row = Math.floor(i / 7);
        const cx = 10 + col * 24;
        const cy = 34 + row * Math.max(14, Math.min(18, 60 / rows));
        if (d == null) return null;
        const isNext = d === nextDay;
        const isToday = d === todayDay;
        return (
          <g key={i}>
            {isNext && <circle cx={cx} cy={cy} r="8" fill="#7c3aed" />}
            {!isNext && isToday && <circle cx={cx} cy={cy} r="8" fill="none" stroke="#c4b5fd" strokeWidth="1" />}
            <text
              x={cx}
              y={cy + 2.5}
              fontSize="7.5"
              fontWeight={isNext ? 700 : isToday ? 600 : 500}
              fill={isNext ? "#fff" : isToday ? "#7c3aed" : "#475569"}
              textAnchor="middle"
            >
              {d}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ScheduleEmptyArt() {
  return (
    <svg viewBox="0 0 150 110" className="h-[110px] w-full" role="img" aria-label="No schedules">
      <defs>
        <linearGradient id="schedSheet" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#f5f3ff" />
        </linearGradient>
      </defs>
      <rect x="22" y="22" width="86" height="70" rx="8" fill="url(#schedSheet)" stroke="#c4b5fd" strokeWidth="1" transform="rotate(-6 65 57)" />
      <rect x="34" y="18" width="86" height="70" rx="8" fill="url(#schedSheet)" stroke="#c4b5fd" strokeWidth="1" transform="rotate(4 77 53)" />
      <rect x="40" y="22" width="74" height="62" rx="7" fill="#fff" stroke="#7c3aed" strokeWidth="1.2" />
      {Array.from({ length: 4 }).map((_, r) =>
        Array.from({ length: 5 }).map((_, c) => (
          <rect
            key={`${r}-${c}`}
            x={46 + c * 12}
            y={32 + r * 12}
            width="8"
            height="8"
            rx="2"
            fill={r === 1 && c === 2 ? "#7c3aed" : r === 1 && c === 1 ? "#a78bfa" : "#ede9fe"}
          />
        )),
      )}
      <circle cx="118" cy="84" r="14" fill="#7c3aed" />
      <text x="118" y="88" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">+</text>
    </svg>
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
  const targetN = Number(w.targetSol);
  const isLow = balanceN != null && balanceN < minN;
  const isPaused = w.status === "paused";
  // Gauge math: 0..target maps to a 240° arc starting at -210° (bottom-left)
  const pct = balanceN == null ? 0 : Math.max(0, Math.min(1, balanceN / Math.max(targetN, 0.0001)));
  const floorPct = Math.max(0, Math.min(1, minN / Math.max(targetN, 0.0001)));
  const arcStart = -210; const arcSweep = 240;
  const polar = (cx: number, cy: number, r: number, angDeg: number) => {
    const a = (angDeg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  const arcPath = (cx: number, cy: number, r: number, fromDeg: number, toDeg: number) => {
    const [x1, y1] = polar(cx, cy, r, fromDeg);
    const [x2, y2] = polar(cx, cy, r, toDeg);
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
    const sweep = toDeg > fromDeg ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`;
  };
  const cx = 80, cy = 78, R = 60;
  const valueEnd = arcStart + arcSweep * pct;
  const floorAng = arcStart + arcSweep * floorPct;
  const verdict: Severity = isPaused ? "neutral" : isLow ? "risk" : balanceN == null ? "neutral" : pct < 0.5 ? "watch" : "good";
  const verdictLabel = isPaused ? "Paused" : balanceN == null ? "Unchecked" : isLow ? "Low — refill drafted" : pct < 0.5 ? "Below comfort" : "Healthy";

  return (
    <BlockShell block={block} accent="violet">
      <div className="grid gap-5 sm:grid-cols-[160px_1fr] sm:items-center">
        {/* Bespoke fuel gauge */}
        <div className="relative mx-auto" style={{ width: 160, height: 130 }}>
          <svg viewBox="0 0 160 140" className="h-32 w-40">
            <defs>
              <linearGradient id="gt-arc" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#7c3aed" />
              </linearGradient>
              <radialGradient id="gt-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx={cx} cy={cy} r={R + 14} fill="url(#gt-glow)" />
            {/* Track */}
            <path d={arcPath(cx, cy, R, arcStart, arcStart + arcSweep)} stroke="#ede9fe" strokeWidth={9} fill="none" strokeLinecap="round" />
            {/* Value */}
            {pct > 0.001 && (
              <path d={arcPath(cx, cy, R, arcStart, valueEnd)} stroke="url(#gt-arc)" strokeWidth={9} fill="none" strokeLinecap="round" />
            )}
            {/* Floor tick */}
            {(() => {
              const [x1, y1] = polar(cx, cy, R - 9, floorAng);
              const [x2, y2] = polar(cx, cy, R + 9, floorAng);
              return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#7c3aed" strokeWidth={1.5} strokeDasharray="2 2" />;
            })()}
            {/* Center label */}
            <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="700" fill="#0f172a" style={{ fontFeatureSettings: "'tnum'" }}>
              {balanceN != null ? balanceN.toFixed(2) : "—"}
            </text>
            <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fontWeight="600" letterSpacing="0.18em" fill="#7c3aed">SOL</text>
            <text x={cx} y={cy + 28} textAnchor="middle" fontSize="8.5" fill="#64748b">floor {minN} · target {targetN}</text>
          </svg>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">Gas tank</p>
            <SignalBadge severity={verdict}>{verdictLabel}</SignalBadge>
          </div>
          <p className="mt-1 text-sm text-slate-700">
            {isLow
              ? `Below floor of ${minN} SOL. Dreyv is preparing a top-up of ${Math.max(targetN - (balanceN ?? 0), 0).toFixed(3)} SOL — review and sign to release.`
              : pct < 0.5
                ? `Sitting at ${(pct * 100).toFixed(0)}% of target. Dreyv will draft a refill the moment it crosses ${minN} SOL.`
                : `Comfortable. ${(pct * 100).toFixed(0)}% of target — runway intact for upcoming on-chain ops.`}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <RunwayStat label="Floor" value={`${minN} SOL`} />
            <RunwayStat label="Target" value={`${targetN} SOL`} />
            <RunwayStat label="Source" value={w.fundingAddress ? `${w.fundingAddress.slice(0, 4)}…${w.fundingAddress.slice(-3)}` : "Not set"} />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            {w.lastCheckedAt ? `Last polled ${new Date(w.lastCheckedAt).toLocaleString()}` : "Awaiting first poll"}
          </p>
          <div className="mt-3 flex items-center gap-1.5">
            <button onClick={() => action("check-now")} disabled={busy === "check-now"} className="rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
              {busy === "check-now" ? "Polling…" : "Check now"}
            </button>
            <button onClick={() => action(isPaused ? "resume" : "pause")} disabled={busy != null} className="rounded-lg border border-violet-200 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50">
              {isPaused ? "Resume" : "Pause"}
            </button>
            <button onClick={() => setEditing(true)} className="rounded-lg px-2 py-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-700">Edit</button>
          </div>
        </div>
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

  // Summary metrics for the header
  const totalsByToken = new Map<string, number>();
  let dueSoon = 0;
  const now = Date.now();
  const week = 7 * 24 * 3600 * 1000;
  for (const r of open) {
    totalsByToken.set(r.token, (totalsByToken.get(r.token) ?? 0) + Number(r.amount));
    if (r.dueAt && new Date(r.dueAt).getTime() - now < week) dueSoon += 1;
  }
  const totalsLine = Array.from(totalsByToken.entries())
    .map(([t, v]) => `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${t}`).join(" · ") || "—";
  // Build a 14-day timeline of upcoming due dates for the SVG
  const horizonDays = 14;
  const timelinePoints = open
    .filter((r) => r.dueAt)
    .map((r) => {
      const days = Math.round((new Date(r.dueAt!).getTime() - now) / (24 * 3600 * 1000));
      return { id: r.id, days, vendor: r.vendorName, token: r.token, amount: Number(r.amount), overdue: days < 0 };
    })
    .filter((p) => p.days <= horizonDays)
    .sort((a, b) => a.days - b.days);

  return (
    <BlockShell block={block} accent="violet">
      {!wallet ? (
        <p className="text-sm text-slate-600">Connect a wallet to track invoices.</p>
      ) : (
        <>
          {(err || bulkMsg) && (
            <p className={`mb-2 rounded-md px-2 py-1 text-[11px] ${err ? "border border-slate-900 bg-slate-900 text-white" : "border border-violet-200 bg-violet-50 text-violet-800"}`}>
              {err ?? bulkMsg}
            </p>
          )}

          {/* Summary header + timeline */}
          {open.length > 0 && (
            <div className="mb-3 grid gap-3 rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/60 to-white p-3 sm:grid-cols-[1fr_220px] sm:items-center">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">Inbox · open</p>
                <p className="mt-1 text-lg font-semibold text-slate-900" style={{ fontFeatureSettings: "'tnum'" }}>
                  {open.length} bill{open.length === 1 ? "" : "s"} · <span className="text-slate-700">{totalsLine}</span>
                </p>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  {dueSoon > 0 ? `${dueSoon} due in the next 7 days` : "Nothing due in the next 7 days"}
                </p>
              </div>
              {/* 14-day due timeline */}
              <div className="relative h-12 w-full">
                <svg viewBox="0 0 220 48" className="h-12 w-full">
                  <line x1={6} y1={32} x2={214} y2={32} stroke="#ede9fe" strokeWidth={2} strokeLinecap="round" />
                  {[0, 7, 14].map((d) => {
                    const x = 6 + (d / horizonDays) * 208;
                    return (
                      <g key={d}>
                        <line x1={x} y1={28} x2={x} y2={36} stroke="#c4b5fd" strokeWidth={1} />
                        <text x={x} y={46} textAnchor="middle" fontSize="7" fill="#7c3aed" fontWeight="600">{d === 0 ? "today" : `+${d}d`}</text>
                      </g>
                    );
                  })}
                  {timelinePoints.slice(0, 14).map((p, i) => {
                    const x = 6 + (Math.max(p.days, 0) / horizonDays) * 208;
                    const r = Math.min(7, 3 + Math.log10(Math.max(p.amount, 1)) * 1.5);
                    return (
                      <g key={p.id}>
                        <circle cx={x} cy={32} r={r} fill={p.overdue ? "#0f172a" : "#7c3aed"} opacity={0.85} />
                        {i < 3 && <text x={x} y={20} textAnchor="middle" fontSize="7" fill="#475569" fontWeight="600">{p.vendor.slice(0, 6)}</text>}
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          )}

          {loading && open.length === 0 ? (
            <p className="text-sm text-slate-500">Loading invoices…</p>
          ) : open.length === 0 ? (
            <div className="grid gap-5 sm:grid-cols-[150px_1fr] sm:items-center">
              <div className="relative mx-auto" style={{ width: 140, height: 110 }}>
                <svg viewBox="0 0 140 110" className="h-28 w-36">
                  {/* Stacked envelope illustration */}
                  {[0, 1, 2].map((i) => (
                    <g key={i} transform={`translate(${10 + i * 6} ${20 + i * 8}) rotate(${-4 + i * 4} 50 30)`}>
                      <rect width={84} height={50} rx={5} fill="#ffffff" stroke="#c4b5fd" strokeWidth={1.2} />
                      <path d="M 0 0 L 42 28 L 84 0" fill="none" stroke="#a78bfa" strokeWidth={1} />
                    </g>
                  ))}
                  <circle cx={108} cy={26} r={9} fill="#7c3aed" />
                  <text x={108} y={30} textAnchor="middle" fontSize="10" fontWeight="700" fill="#ffffff">0</text>
                </svg>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">Inbox empty</p>
                <p className="mt-1 text-sm text-slate-700">No bills waiting. Forward an invoice or import a CSV — Dreyv batches them by due date and routes payments through your policy.</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {["Batched by due date", "Multi-token", "HITL approve"].map((c) => (
                    <span key={c} className="rounded-full border border-violet-200 bg-violet-50/50 px-2 py-0.5 text-[10px] font-medium text-violet-700">{c}</span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-violet-100">
              {open.map((r) => {
                const dueDays = r.dueAt ? Math.round((new Date(r.dueAt).getTime() - now) / (24 * 3600 * 1000)) : null;
                const dueTone: Severity = dueDays == null ? "neutral" : dueDays < 0 ? "risk" : dueDays <= 3 ? "watch" : "good";
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <DreyvStar size={10} className="text-violet-500" />
                        <span className="truncate font-semibold text-slate-900">{r.vendorName}</span>
                        {r.status === "queued" && <SignalBadge severity="neutral">In approval</SignalBadge>}
                        {dueDays != null && <SignalBadge severity={dueTone}>{dueDays < 0 ? `${-dueDays}d overdue` : dueDays === 0 ? "due today" : `due in ${dueDays}d`}</SignalBadge>}
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-slate-500" style={{ fontFeatureSettings: "'tnum'" }}>
                        {Number(r.amount).toLocaleString()} {r.token}
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
                          className="rounded-lg border border-violet-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-violet-50">
                          Reject
                        </button>
                      )}
                      <button onClick={() => action(r.id, "delete")} disabled={busy === r.id}
                        className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-400 hover:text-slate-700">×</button>
                    </div>
                  </li>
                );
              })}
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
            <div className="grid gap-5 sm:grid-cols-[150px_1fr] sm:items-center">
              <div className="relative mx-auto" style={{ width: 140, height: 110 }}>
                <svg viewBox="0 0 140 110" className="h-28 w-36">
                  <defs>
                    <linearGradient id="yld-line" x1="0" x2="1" y1="0" y2="0">
                      <stop offset="0%" stopColor="#c4b5fd" />
                      <stop offset="100%" stopColor="#7c3aed" />
                    </linearGradient>
                  </defs>
                  {/* Idle stables pool */}
                  <circle cx={28} cy={55} r={18} fill="#f5f3ff" stroke="#c4b5fd" strokeWidth={1.2} />
                  <text x={28} y={59} textAnchor="middle" fontSize="9" fontWeight="600" fill="#7c3aed">USDC</text>
                  {/* Routing arcs */}
                  {[0, 1, 2].map((i) => {
                    const ty = 22 + i * 33;
                    return (
                      <path key={i} d={`M 46 55 C 70 55, 80 ${ty}, 104 ${ty}`} stroke="url(#yld-line)" strokeWidth={1.4} fill="none" strokeDasharray="3 2" />
                    );
                  })}
                  {/* Venue tiles */}
                  {["Marinade", "Kamino", "Drift"].map((v, i) => {
                    const ty = 22 + i * 33;
                    return (
                      <g key={v}>
                        <rect x={104} y={ty - 8} width={32} height={16} rx={4} fill="#ffffff" stroke="#a78bfa" strokeWidth={1} />
                        <text x={120} y={ty + 3} textAnchor="middle" fontSize="7" fontWeight="600" fill="#5b21b6">{v}</text>
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">Idle → earning</p>
                <p className="mt-1 text-sm text-slate-700">
                  {stableBalance > 0
                    ? `${stableBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })} in stables sitting idle. Route a slice to a vetted venue inside your risk band — every deploy goes through HITL.`
                    : "Set a route now and it activates the moment idle stables land. Policy-bounded, HITL-gated."}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {["Conservative", "Balanced", "Aggressive"].map((c) => (
                    <span key={c} className="rounded-full border border-violet-200 bg-violet-50/50 px-2 py-0.5 text-[10px] font-medium text-violet-700">{c}</span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {routes.map((r) => {
                const venueLabel = YIELD_VENUES.find((v) => v.id === r.venue)?.label ?? r.venue;
                const sev: Severity = r.status === "active" ? "good" : r.status === "paused" ? "watch" : r.status === "exited" ? "neutral" : "neutral";
                const liveApy = r.lastApyBps != null ? r.lastApyBps / 100 : null;
                const minApy = r.minApyBps != null ? r.minApyBps / 100 : null;
                // APY ring: scale 0..25%
                const apyPct = liveApy != null ? Math.max(0, Math.min(1, liveApy / 25)) : 0;
                const ringR = 18, ringC = 2 * Math.PI * ringR;
                const dash = ringC * apyPct;
                return (
                  <div key={r.id} className="rounded-2xl border border-violet-100 bg-gradient-to-br from-white to-violet-50/30 p-3">
                    <div className="flex items-start gap-3">
                      <div className="relative shrink-0" style={{ width: 56, height: 56 }}>
                        <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
                          <circle cx={28} cy={28} r={ringR} stroke="#ede9fe" strokeWidth={5} fill="none" />
                          {liveApy != null && (
                            <circle cx={28} cy={28} r={ringR} stroke="#7c3aed" strokeWidth={5} fill="none"
                              strokeLinecap="round" strokeDasharray={`${dash} ${ringC}`} />
                          )}
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-[11px] font-semibold text-slate-900" style={{ fontFeatureSettings: "'tnum'" }}>
                            {liveApy != null ? `${liveApy.toFixed(1)}%` : "—"}
                          </span>
                          <span className="text-[7px] font-semibold uppercase tracking-wider text-violet-600">APY</span>
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <DreyvStar size={10} className="text-violet-500" />
                          <span className="truncate text-sm font-semibold text-slate-900">{venueLabel}</span>
                          <SignalBadge severity={sev}>{r.status}</SignalBadge>
                        </div>
                        <p className="mt-0.5 text-[12px] text-slate-600" style={{ fontFeatureSettings: "'tnum'" }}>
                          {Number(r.targetAmount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {r.token}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {r.riskBand} band{minApy != null ? ` · floor ${minApy.toFixed(2)}%` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {r.status === "draft" && (
                        <button onClick={() => action(r.id, "deploy")} disabled={busy != null}
                          className="rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                          {busy === `${r.id}:deploy` ? "Queueing…" : "Deploy"}
                        </button>
                      )}
                      {r.status === "active" && (
                        <>
                          <button onClick={() => action(r.id, "pause")} disabled={busy != null}
                            className="rounded-md border border-violet-200 px-2 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50">Pause</button>
                          <button onClick={() => action(r.id, "exit")} disabled={busy != null}
                            className="rounded-md border border-violet-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-violet-50">Exit</button>
                        </>
                      )}
                      {r.status === "paused" && (
                        <button onClick={() => action(r.id, "resume")} disabled={busy != null}
                          className="rounded-md border border-violet-200 px-2 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50">Resume</button>
                      )}
                      <button onClick={() => remove(r.id)} disabled={busy != null}
                        className="ml-auto rounded-md px-1.5 py-1 text-[11px] text-slate-400 hover:text-slate-700">×</button>
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
            <div className="grid gap-5 sm:grid-cols-[150px_1fr] sm:items-center">
              <div className="relative mx-auto" style={{ width: 140, height: 110 }}>
                <svg viewBox="0 0 140 110" className="h-28 w-36">
                  <defs>
                    <linearGradient id="rep-bg" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#f5f3ff" />
                      <stop offset="100%" stopColor="#ffffff" />
                    </linearGradient>
                  </defs>
                  {/* Stacked report sheets */}
                  <rect x={28} y={22} width={70} height={84} rx={6} fill="url(#rep-bg)" stroke="#ddd6fe" strokeWidth={1} transform="rotate(-6 63 64)" />
                  <rect x={36} y={16} width={70} height={84} rx={6} fill="#ffffff" stroke="#c4b5fd" strokeWidth={1.2} />
                  {/* report contents */}
                  <rect x={44} y={26} width={36} height={4} rx={2} fill="#7c3aed" />
                  <rect x={44} y={36} width={54} height={2.5} rx={1.25} fill="#e9d5ff" />
                  <rect x={44} y={42} width={48} height={2.5} rx={1.25} fill="#e9d5ff" />
                  {/* mini bar chart */}
                  <rect x={44} y={56} width={6} height={20} rx={1} fill="#a78bfa" />
                  <rect x={54} y={50} width={6} height={26} rx={1} fill="#8b5cf6" />
                  <rect x={64} y={44} width={6} height={32} rx={1} fill="#7c3aed" />
                  <rect x={74} y={52} width={6} height={24} rx={1} fill="#a78bfa" />
                  <rect x={84} y={48} width={6} height={28} rx={1} fill="#8b5cf6" />
                  <rect x={44} y={84} width={54} height={2.5} rx={1.25} fill="#ede9fe" />
                  <rect x={44} y={90} width={40} height={2.5} rx={1.25} fill="#ede9fe" />
                </svg>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">Board-ready</p>
                <p className="mt-1 text-sm text-slate-700">Generate a snapshot — composition, valuation, 24h move — and publish a read-only link for accountants and stakeholders.</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {["PDF export", "Read-only link", "Auto-expires"].map((c) => (
                    <span key={c} className="rounded-full border border-violet-200 bg-violet-50/50 px-2 py-0.5 text-[10px] font-medium text-violet-700">{c}</span>
                  ))}
                </div>
              </div>
            </div>
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

  const sev: Severity = audit == null ? "neutral" : audit.score >= 80 ? "good" : audit.score >= 50 ? "watch" : "risk";
  const arcColor = sev === "good" ? "#7c3aed" : sev === "watch" ? "#a78bfa" : sev === "risk" ? "#5b21b6" : "#c4b5fd";
  const score = audit?.score ?? 0;
  // Closed-circle hygiene gauge
  const R = 38, C = 2 * Math.PI * R;
  const dash = (score / 100) * C;

  return (
    <BlockShell block={block} accent="violet">
      {loading && !audit ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !audit ? (
        <div className="grid gap-5 sm:grid-cols-[150px_1fr] sm:items-center">
          {/* Visual preview — signer graph */}
          <div className="relative mx-auto" style={{ width: 140, height: 130 }}>
            <svg viewBox="0 0 140 130" className="h-32 w-36">
              <defs>
                <radialGradient id="sec-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle cx={70} cy={65} r={60} fill="url(#sec-glow)" />
              {/* center vault */}
              <circle cx={70} cy={65} r={18} fill="#ffffff" stroke="#7c3aed" strokeWidth={1.5} />
              <path d="M70 56 L62 60 v8 c0 6 4 10 8 12 4-2 8-6 8-12 v-8 z" fill="none" stroke="#7c3aed" strokeWidth={1.5} strokeLinejoin="round" />
              {/* satellite signers */}
              {[0, 1, 2, 3, 4].map((i) => {
                const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
                const x = 70 + 48 * Math.cos(a);
                const y = 65 + 48 * Math.sin(a);
                return (
                  <g key={i}>
                    <line x1={70} y1={65} x2={x} y2={y} stroke="#ddd6fe" strokeWidth={1} strokeDasharray="2 2" />
                    <circle cx={x} cy={y} r={8} fill="#f5f3ff" stroke="#a78bfa" strokeWidth={1.2} />
                  </g>
                );
              })}
            </svg>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">Hygiene audit</p>
            <p className="mt-1 text-sm text-slate-700">Dreyv will inspect your signer roster, multisig threshold, key reuse, and surface a 0–100 hygiene score with prioritized findings.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["Signer roster", "Threshold", "Key reuse", "Cold/hot mix"].map((c) => (
                <span key={c} className="rounded-full border border-violet-200 bg-violet-50/50 px-2 py-0.5 text-[10px] font-medium text-violet-700">{c}</span>
              ))}
            </div>
            <button onClick={runAudit} disabled={busy}
              className="mt-3 inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
              {busy ? "Auditing…" : "Run security audit"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-[120px_1fr] sm:items-center">
            <div className="relative mx-auto" style={{ width: 110, height: 110 }}>
              <svg width="110" height="110" viewBox="0 0 110 110">
                <circle cx={55} cy={55} r={R} stroke="#f5f3ff" strokeWidth={10} fill="none" />
                <circle
                  cx={55} cy={55} r={R}
                  stroke={arcColor}
                  strokeWidth={10}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${dash} ${C}`}
                  transform="rotate(-90 55 55)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="font-manrope text-2xl font-semibold leading-none text-slate-900 tabular-nums">{audit.score}</div>
                <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500">/ 100</div>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">Hygiene</p>
                <SignalBadge severity={sev}>{audit.score >= 80 ? "Healthy" : audit.score >= 50 ? "Improve" : "At risk"}</SignalBadge>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {audit.isMultisig ? `Squads multisig${audit.threshold ? ` · ${audit.threshold}-of-${audit.signers.length}` : ""}` : "Single signer"}
              </p>
              {audit.findings.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {audit.findings.slice(0, 4).map((f, i) => {
                    const fsev: Severity = f.severity === "high" ? "risk" : f.severity === "warn" ? "watch" : "good";
                    const tone = fsev === "risk" ? "text-slate-900" : fsev === "watch" ? "text-amber-700" : "text-violet-700";
                    return (
                      <li key={i} className="flex items-start gap-2 text-[12px]">
                        <DreyvStar size={9} className={`${tone} mt-1 shrink-0`} />
                        <span className="text-slate-700">{f.message}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {audit.signers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {audit.signers.slice(0, 6).map((s, i) => (
                    <span key={i} className="rounded-full border border-violet-100 bg-white px-2 py-0.5 font-mono text-[10px] text-slate-600">
                      {s.label ?? `${s.address.slice(0, 4)}…${s.address.slice(-4)}`}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
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
