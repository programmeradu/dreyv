"use client";

/**
 * CompactCard — uniform spec for the /analytics bottom-row panels.
 *
 * Strict shape so the 4 cards align on a shared baseline:
 *   row 1: eyebrow (left) + optional SignalBadge (right)
 *   row 2: headline value (font-manrope, 22px) — always one line, tabular-nums
 *   row 3: subline (xs, slate-500) — always one line for rhythm
 *   row 4: micro-viz canvas — fixed height (h-[88px]) so all cards match
 *
 * FLAT only — no shadows / blur / gradients / ring. Per analytics design rules.
 */

import { ReactNode } from "react";
import { DreyvStar } from "@/components/studio/DreyvStar";

interface CompactCardProps {
  eyebrow: string;
  badge?: ReactNode;
  headline: ReactNode;
  subline?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function CompactCard({
  eyebrow,
  badge,
  headline,
  subline,
  children,
  className,
}: CompactCardProps) {
  return (
    <div
      className={`flex h-full flex-col rounded-3xl border border-violet-100 bg-white p-4 ${className ?? ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-violet-700">
          <DreyvStar size={9} />
          <span className="truncate text-[10px] font-semibold uppercase tracking-[0.18em]">
            {eyebrow}
          </span>
        </div>
        {badge}
      </div>

      <div className="mt-2 truncate font-manrope text-[22px] font-semibold leading-none tracking-tight tabular-nums text-slate-900">
        {headline}
      </div>

      <div className="mt-1.5 line-clamp-1 text-[11px] text-slate-500">
        {subline ?? "\u00a0"}
      </div>

      <div className="mt-3 flex h-[88px] flex-1 items-end">
        {children}
      </div>
    </div>
  );
}

export function EmptyMicro({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-2xl border border-dashed border-violet-100 px-3 text-center text-[10px] text-slate-400">
      {label}
    </div>
  );
}
