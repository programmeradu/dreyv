"use client";

import type { InfographicSpec } from "@/lib/media-studio/types";

export function InfographicCanvas({
  spec,
  aspect = "1:1",
}: {
  spec: InfographicSpec;
  aspect?: "1:1" | "4:5" | "16:9";
}) {
  const ratio = aspect === "16:9" ? "16 / 9" : aspect === "4:5" ? "4 / 5" : "1 / 1";

  return (
    <div className="relative w-full overflow-hidden rounded-3xl border border-studio-border bg-studio-surface text-studio-fg" style={{ aspectRatio: ratio }}>
      <div className="relative flex h-full flex-col p-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm bg-studio-violet" />
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-studio-violet">Dreyv</span>
          </div>
          <span className="text-[10px] uppercase tracking-[0.2em] text-studio-muted">{spec.layout.replace("-", " ")}</span>
        </div>

        <div className="mt-6">
          <h2 className="text-3xl font-bold leading-tight tracking-normal md:text-4xl">{spec.title}</h2>
          {spec.subtitle && <p className="mt-2 max-w-prose text-sm text-studio-muted">{spec.subtitle}</p>}
        </div>

        <div className="mt-6 flex-1">
          {spec.layout === "stat-hero" && spec.heroStat ? (
            <div className="flex h-full flex-col justify-center">
              <div className="text-7xl font-extrabold leading-none text-studio-violet md:text-8xl">{spec.heroStat.value}</div>
              <div className="mt-3 text-base font-medium text-studio-fg">{spec.heroStat.label}</div>
              <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {spec.bullets.slice(0, 4).map((b, i) => <BulletRow key={i} label={b.label} value={b.value} detail={b.detail} />)}
              </div>
            </div>
          ) : spec.layout === "three-pillars" ? (
            <div className="grid h-full grid-cols-1 gap-4 sm:grid-cols-3">
              {spec.bullets.slice(0, 3).map((b, i) => <PillarCard key={i} index={i + 1} label={b.label} value={b.value} detail={b.detail} />)}
            </div>
          ) : spec.layout === "comparison" ? (
            <div className="grid h-full grid-cols-2 gap-4">
              {spec.bullets.slice(0, 2).map((b, i) => <ComparisonCard key={i} highlight={i === 0} label={b.label} value={b.value} detail={b.detail} />)}
            </div>
          ) : (
            <div className="space-y-3">
              {spec.bullets.map((b, i) => <TimelineRow key={i} step={i + 1} label={b.label} value={b.value} detail={b.detail} />)}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-end justify-between">
          <span className="text-[11px] uppercase tracking-[0.18em] text-studio-muted">{spec.footnote ?? "dreyv.com"}</span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-studio-violet">DRAVE</span>
        </div>
      </div>
    </div>
  );
}

function BulletRow({ label, value, detail }: { label: string; value?: string; detail?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-studio-border bg-studio-violet-soft p-3">
      <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-studio-violet" />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold">{label}</span>
          {value && <span className="text-sm font-bold text-studio-violet">{value}</span>}
        </div>
        {detail && <p className="mt-0.5 text-xs text-studio-muted">{detail}</p>}
      </div>
    </div>
  );
}

function PillarCard({ index, label, value, detail }: { index: number; label: string; value?: string; detail?: string }) {
  return (
    <div className="flex h-full flex-col rounded-3xl border border-studio-border bg-studio-surface p-5">
      <span className="text-xs font-semibold uppercase tracking-widest text-studio-violet">0{index}</span>
      <div className="mt-3 text-lg font-bold leading-tight">{label}</div>
      {value && <div className="mt-2 text-3xl font-extrabold text-studio-violet">{value}</div>}
      {detail && <p className="mt-3 text-xs text-studio-muted">{detail}</p>}
    </div>
  );
}

function ComparisonCard({ highlight, label, value, detail }: { highlight: boolean; label: string; value?: string; detail?: string }) {
  return (
    <div className={"flex h-full flex-col rounded-3xl p-5 " + (highlight ? "bg-studio-violet text-primary-foreground" : "border border-studio-border bg-studio-surface") }>
      <div className={"text-xs font-semibold uppercase tracking-widest " + (highlight ? "text-primary-foreground/80" : "text-studio-violet")}>{highlight ? "With Dreyv" : "Without"}</div>
      <div className="mt-3 text-lg font-bold leading-tight">{label}</div>
      {value && <div className="mt-2 text-4xl font-extrabold">{value}</div>}
      {detail && <p className={"mt-3 text-xs " + (highlight ? "text-primary-foreground/85" : "text-studio-muted")}>{detail}</p>}
    </div>
  );
}

function TimelineRow({ step, label, value, detail }: { step: number; label: string; value?: string; detail?: string }) {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-studio-border bg-studio-surface p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-studio-violet text-sm font-bold text-primary-foreground">{step}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">{label}</span>
          {value && <span className="text-sm font-bold text-studio-violet">{value}</span>}
        </div>
        {detail && <p className="mt-0.5 text-xs text-studio-muted">{detail}</p>}
      </div>
    </div>
  );
}
