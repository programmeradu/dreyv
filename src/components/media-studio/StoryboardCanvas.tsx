"use client";

import type { VideoStoryboard } from "@/lib/media-studio/types";

export function StoryboardCanvas({ spec }: { spec: VideoStoryboard }) {
  return (
    <div className="rounded-3xl border border-studio-border bg-studio-surface p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-studio-violet">Storyboard</div>
          <h3 className="mt-1 text-2xl font-bold tracking-normal text-studio-fg">{spec.title}</h3>
        </div>
        <div className="flex shrink-0 flex-col items-end text-xs text-studio-muted">
          <span>{spec.durationSeconds}s · {spec.aspect}</span>
          {spec.music && <span className="mt-0.5">♪ {spec.music}</span>}
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-studio-violet p-4 text-primary-foreground">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-foreground/70">Hook (0-2s)</div>
        <div className="mt-1 text-base font-semibold leading-snug">{spec.hookLine}</div>
      </div>

      <ol className="mt-5 space-y-4">
        {spec.scenes.map((s, i) => (
          <li key={i} className="rounded-2xl border border-studio-border bg-studio-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-studio-violet">Scene {i + 1}</span>
              <span className="text-[10px] font-mono text-studio-muted">{s.timeRange}</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Field label="Visual" value={s.visual} className="sm:col-span-1" />
              {s.voiceover && <Field label="VO" value={s.voiceover} />}
              {s.onScreenText && <Field label="On-screen" value={s.onScreenText} />}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-2xl border border-studio-border bg-studio-violet-soft p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-studio-violet">Closing CTA</div>
        <div className="mt-1 text-sm font-semibold text-studio-fg">{spec.closingCta}</div>
      </div>
    </div>
  );
}

function Field({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-studio-muted">{label}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-studio-fg">{value}</div>
    </div>
  );
}
