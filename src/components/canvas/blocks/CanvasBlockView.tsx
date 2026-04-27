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
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

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
            {rows.slice(0, 12).map((r) => {
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
  const months = asNumber(block.payload.months);
  const burn = asNumber(block.payload.monthlyBurn);
  const balance = asNumber(block.payload.stableBalance);
  const insufficient = block.payload.insufficient === true;

  if (insufficient || months === null) {
    return (
      <BlockShell block={block} accent="slate">
        <p className="text-sm text-slate-600">
          Not enough on-chain history yet to estimate runway. Once Dreyv has watched a few weeks of outflows, this will fill in automatically.
        </p>
      </BlockShell>
    );
  }

  const tone = months >= 18 ? "emerald" : months >= 9 ? "violet" : "rose";

  return (
    <BlockShell block={block} accent={tone === "rose" ? "rose" : "violet"}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Runway</p>
          <p className="mt-1 font-manrope text-3xl font-semibold tracking-tight text-slate-900">
            <StreamingNumber value={months} decimals={1} suffix=" months" />
          </p>
          <p className="mt-1 text-xs text-slate-500">
            at {fmtUsd(burn)}/mo burn · {fmtUsd(balance)} stable balance
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
          <div className="overflow-hidden rounded-xl border border-violet-100">
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
        )}

        <div className="flex items-center justify-between gap-3 border-t border-violet-100 pt-3">
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
          <div className="grid grid-cols-3 gap-2">
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
