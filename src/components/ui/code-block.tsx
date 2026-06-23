"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

type CodeBlockProps = {
  children: string;
  language?: string;
  className?: string;
  /** When true, wraps long lines instead of horizontal scrolling. */
  wrap?: boolean;
  /** Compact density for cards/sidebars. */
  dense?: boolean;
  /** Optional aria-label override for the copy button. */
  copyLabel?: string;
};

/**
 * Light-themed code block with a built-in copy button.
 * Brand-consistent: slate-50 surface, violet-100 border, slate-800 text.
 */
export function CodeBlock({
  children,
  language,
  className,
  wrap = false,
  dense = false,
  copyLabel = "Copy code",
}: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);

  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }, [children]);

  return (
    <div
      className={cn(
        "group relative rounded-2xl border border-violet-100 bg-slate-50/80",
        className
      )}
    >
      {language ? (
        <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
            {language}
          </span>
        </div>
      ) : null}
      <button
        type="button"
        onClick={onCopy}
        aria-label={copyLabel}
        className={cn(
          "absolute top-2.5 right-2.5 z-10 inline-flex items-center gap-1.5 rounded-lg",
          "border border-violet-200 bg-white/90 px-2 py-1 text-[10.5px] font-semibold",
          "text-violet-700 shadow-sm backdrop-blur transition",
          "hover:bg-violet-50 hover:border-violet-300",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        )}
      >
        {copied ? (
          <>
            <Check className="h-3 w-3" /> Copied
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" /> Copy
          </>
        )}
      </button>
      <pre
        className={cn(
          "overflow-x-auto font-mono text-slate-800 leading-relaxed",
          dense ? "p-3 text-[11.5px]" : "p-4 sm:p-5 text-[12.5px]",
          wrap && "whitespace-pre-wrap break-all",
          language && "pt-1"
        )}
      >
        <code className="block pr-14">{children}</code>
      </pre>
    </div>
  );
}

export default CodeBlock;
