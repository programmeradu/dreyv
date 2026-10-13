"use client";

import { useCallback, useState } from "react";

type Props = {
  code: string;
  label: string;
  /** Wrap long lines (prompts) instead of scrolling sideways (config, shell). */
  wrap?: boolean;
  dark?: boolean;
};

/** Code or prompt block with a plain text copy button. */
export function CopyCode({ code, label, wrap = false, dark = false }: Props) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }, [code]);

  return (
    <div style={{ position: "relative" }}>
      <pre
        className={`mk-code${dark ? "" : " mk-code-light"}${wrap ? " mk-code-wrap" : ""}`}
        aria-label={label}
        tabIndex={0}
        style={{ paddingTop: 44 }}
      >
        {code}
      </pre>
      <button
        type="button"
        onClick={onCopy}
        className="mk-btn mk-btn-sm"
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          minHeight: 30,
          padding: "0 12px",
          fontSize: 13,
          background: dark ? "rgba(255,255,255,0.12)" : "rgba(42,15,115,0.07)",
          color: dark ? "#ffffff" : "var(--mk-ink)",
        }}
        aria-label={`Copy ${label}`}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="mk-sr" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}
