"use client";

import * as React from "react";
import { Copy, Check } from "lucide-react";

/**
 * Renders a copy variant card with a one-click copy-to-clipboard button.
 * Used by the Post + Announcement tabs in the Media Studio.
 */
export function CopyVariantCard({
  index,
  headline,
  body,
  cta,
  onSave,
}: {
  index: number;
  headline?: string;
  body: string;
  cta?: string;
  onSave?: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const fullText = [headline, body, cta].filter(Boolean).join("\n\n");

  return (
    <div className="rounded-3xl border border-violet-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">
          Variant {String.fromCharCode(64 + index)}
        </span>
        <div className="flex items-center gap-2">
          {onSave && (
            <button
              onClick={onSave}
              className="rounded-full border border-violet-200 px-3 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50"
            >
              Save
            </button>
          )}
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(fullText);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {}
            }}
            className="flex items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1 text-xs font-semibold text-white hover:bg-violet-700"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-3 text-sm leading-relaxed text-[#0B0820]">
        {headline && <div className="text-base font-bold tracking-tight">{headline}</div>}
        <p className="whitespace-pre-wrap">{body}</p>
        {cta && <div className="text-sm font-semibold text-violet-700">{cta}</div>}
      </div>
    </div>
  );
}
