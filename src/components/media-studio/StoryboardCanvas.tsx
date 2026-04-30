"use client";

import * as React from "react";
import type { VideoStoryboard } from "@/lib/media-studio/types";

/**
 * Renders a generated video storyboard as a vertical scene list. We don't
 * render actual video pixels in v1 — the team takes the storyboard into
 * the existing videogen pipeline.
 */
export function StoryboardCanvas({ spec }: { spec: VideoStoryboard }) {
  return (
    <div className="rounded-3xl border border-violet-200 bg-white p-6" style={{ fontFamily: "Manrope, ui-sans-serif, system-ui" }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-700">Storyboard</div>
          <h3 className="mt-1 text-2xl font-bold tracking-tight text-[#0B0820]">{spec.title}</h3>
        </div>
        <div className="flex flex-col items-end text-xs text-[#0B0820]/60">
          <span>{spec.durationSeconds}s · {spec.aspect}</span>
          {spec.music && <span className="mt-0.5">♪ {spec.music}</span>}
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-violet-600 p-4 text-white">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">Hook (0-2s)</div>
        <div className="mt-1 text-base font-semibold leading-snug">{spec.hookLine}</div>
      </div>

      <ol className="mt-5 space-y-4">
        {spec.scenes.map((s, i) => (
          <li key={i} className="rounded-2xl border border-violet-100 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-violet-700">
                Scene {i + 1}
              </span>
              <span className="text-[10px] font-mono text-[#0B0820]/50">{s.timeRange}</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Field label="Visual" value={s.visual} className="sm:col-span-1" />
              {s.voiceover && <Field label="VO" value={s.voiceover} />}
              {s.onScreenText && <Field label="On-screen" value={s.onScreenText} />}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50/70 p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">Closing CTA</div>
        <div className="mt-1 text-sm font-semibold text-[#0B0820]">{spec.closingCta}</div>
      </div>
    </div>
  );
}

function Field({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[#0B0820]/55">{label}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-[#0B0820]/85">{value}</div>
    </div>
  );
}
