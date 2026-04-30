"use client";

import * as React from "react";
import { Copy, Check } from "lucide-react";

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
    <div className="rounded-3xl border border-studio-border bg-studio-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-studio-violet">
          Variant {String.fromCharCode(64 + index)}
        </span>
        <div className="flex items-center gap-2">
          {onSave && (
            <button
              onClick={onSave}
              className="rounded-full border border-studio-border px-3 py-1 text-xs font-semibold text-studio-violet hover:bg-studio-violet-soft"
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
            className="flex items-center gap-1.5 rounded-full bg-studio-violet px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-3 text-sm leading-relaxed text-studio-fg">
        {headline && <div className="text-base font-bold tracking-normal">{headline}</div>}
        <p className="whitespace-pre-wrap">{body}</p>
        {cta && <div className="text-sm font-semibold text-studio-violet">{cta}</div>}
      </div>
    </div>
  );
}
