"use client";

/**
 * WidgetInfo — single, quiet ⓘ button that consolidates
 * source, freshness, methodology link, and disclaimer.
 *
 * Replaces multi-badge widget headers across Atlas.
 */

import React from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface WidgetInfoProps {
  /** Where the data comes from (e.g. "Jupiter", "Helius DAS"). */
  source?: string;
  /** Epoch ms of last update. */
  updatedAt?: number | null;
  /** Short methodology blurb. */
  methodology?: string;
  /** Optional docs/methodology link. */
  methodologyHref?: string;
  /** Trailing disclaimer line. Defaults to standard NFA copy. */
  disclaimer?: string;
  /** Optional aria-label override. */
  label?: string;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function WidgetInfo({
  source,
  updatedAt,
  methodology,
  methodologyHref,
  disclaimer = "Informational only — not financial advice.",
  label = "About this widget",
}: WidgetInfoProps) {
  const isFresh = typeof updatedAt === "number" && Date.now() - updatedAt < 60_000;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-64 p-3 text-xs space-y-2"
      >
        {(source || updatedAt) && (
          <div className="flex items-center justify-between gap-2 text-[11px]">
            {source && (
              <span className="font-medium text-foreground">{source}</span>
            )}
            {updatedAt && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isFresh ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                {relativeTime(updatedAt)}
              </span>
            )}
          </div>
        )}
        {methodology && (
          <p className="text-muted-foreground leading-relaxed">{methodology}</p>
        )}
        {methodologyHref && (
          <a
            href={methodologyHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-[11px] font-medium text-violet-600 hover:text-violet-700 hover:underline"
          >
            How is this calculated? →
          </a>
        )}
        <p className="pt-1 border-t border-border/60 text-[10px] text-muted-foreground/80">
          {disclaimer}
        </p>
      </PopoverContent>
    </Popover>
  );
}
