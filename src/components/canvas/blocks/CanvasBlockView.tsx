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
    default:
      return null;
  }
}

function NarrativeBlock({ block }: { block: CanvasBlock }) {
  const message = asString(block.payload.message ?? block.payload.detail);
  return (
    <BlockShell block={block} accent="slate">
      {message ? (
        <p className="text-sm leading-relaxed text-slate-700">{message}</p>
      ) : null}
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
        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <GlyphCheck />
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
      <div className="flex items-center justify-between gap-3">
        {summary && <p className="text-sm leading-relaxed text-slate-700">{summary}</p>}
        <Pill tone={statusTone as "violet" | "emerald" | "rose" | "slate"}>
          {status === "running" || status === "streaming" ? (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          ) : null}
          {status}
        </Pill>
      </div>
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
            success ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
          }`}
        >
          {success ? <GlyphCheck className="h-3.5 w-3.5" /> : <GlyphAlert className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0">
          {operation && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {operation}
            </p>
          )}
          {message && <p className="mt-1 text-sm leading-relaxed text-slate-700">{message}</p>}
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
