/**
 * DeliverableView — renders the "output" of a completed inbox row.
 *
 * Handles four artifact shapes coming back from the router / capabilities:
 *   1. Downloadable artifacts        → {url, filename, kind}  → CTA buttons
 *   2. On-chain signatures           → Solscan link
 *   3. Narrative summary / markdown  → prose block + copy + download .md
 *   4. Anything else                 → collapsed raw JSON
 */

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Download, ExternalLink, FileText, ChevronDown, ChevronRight } from "lucide-react";

type Artifact = {
  url?: string;
  path?: string;
  filename?: string;
  kind?: string;
  mime?: string;
};

type ReadResult = {
  capabilityId: string;
  sideEffects: string;
  summary?: string;
  output: unknown;
};

export type DeliverablePayload = {
  readResults?: ReadResult[];
  signature?: string | null;
  operation?: string;
  buildErrors?: string[];
};

function extractArtifacts(output: unknown): Artifact[] {
  if (!output || typeof output !== "object") return [];
  const anyOut = output as Record<string, unknown>;
  const arr = anyOut.artifacts;
  if (!Array.isArray(arr)) return [];
  return arr.filter((a): a is Artifact => !!a && typeof a === "object");
}

function extractMessage(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const m = (output as { message?: unknown }).message;
  return typeof m === "string" ? m : null;
}

function toMarkdown(r: ReadResult): string {
  const lines: string[] = [];
  lines.push(`# ${r.capabilityId}`);
  if (r.summary) lines.push("", r.summary);
  const msg = extractMessage(r.output);
  if (msg && msg !== r.summary) lines.push("", msg);
  lines.push("", "---", "", "```json", JSON.stringify(r.output, null, 2), "```");
  return lines.join("\n");
}

function downloadFile(name: string, mime: string, body: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DeliverableView({
  payload,
  compact = false,
}: {
  payload: DeliverablePayload;
  compact?: boolean;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const results = payload.readResults ?? [];
  const hasSig = !!payload.signature;

  if (results.length === 0 && !hasSig && !(payload.buildErrors?.length)) {
    return (
      <div className="rounded-lg border border-dashed border-violet-100 bg-white px-3 py-2.5 text-[11.5px] text-neutral-500">
        No output captured for this plan.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {hasSig && (
        <a
          href={`https://solscan.io/tx/${payload.signature}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
        >
          <ExternalLink className="h-3 w-3" />
          <span className="font-mono">{payload.signature!.slice(0, 10)}…{payload.signature!.slice(-6)}</span>
        </a>
      )}

      {results.map((r, i) => {
        const artifacts = extractArtifacts(r.output);
        const msg = extractMessage(r.output);
        const body = r.summary || msg;
        return (
          <div
            key={i}
            className="rounded-lg border border-violet-100 bg-white"
          >
            <div className="flex items-center justify-between gap-2 border-b border-violet-100 px-3 py-1.5">
              <span className="font-mono text-[10.5px] font-semibold text-violet-700">
                {r.capabilityId}
              </span>
              <span className="text-[9.5px] uppercase tracking-wider text-neutral-400">
                {r.sideEffects}
              </span>
            </div>

            {body && (
              <div className="px-3 py-2 text-[12px] leading-relaxed text-neutral-800 whitespace-pre-wrap">
                {compact && body.length > 320 ? body.slice(0, 320) + "…" : body}
              </div>
            )}

            {artifacts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-violet-100 px-3 py-2">
                {artifacts.map((a, j) => (
                  <a
                    key={j}
                    href={a.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700"
                  >
                    <Download className="h-3 w-3" />
                    {a.filename ?? a.path ?? `${a.kind ?? "file"}.${(a.mime ?? "").split("/")[1] ?? "bin"}`}
                  </a>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 border-t border-violet-100 px-3 py-1.5 text-[10.5px]">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(body ?? JSON.stringify(r.output, null, 2));
                  toast.success("Copied");
                }}
                className="inline-flex items-center gap-1 font-semibold text-neutral-600 hover:text-violet-700"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
              <button
                onClick={() =>
                  downloadFile(
                    `${r.capabilityId}-${Date.now()}.md`,
                    "text/markdown",
                    toMarkdown(r),
                  )
                }
                className="inline-flex items-center gap-1 font-semibold text-neutral-600 hover:text-violet-700"
              >
                <FileText className="h-3 w-3" /> .md
              </button>
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="ml-auto inline-flex items-center gap-1 font-semibold text-neutral-500 hover:text-violet-700"
              >
                {showRaw ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                JSON
              </button>
            </div>

            {showRaw && (
              <pre className="max-h-64 overflow-auto border-t border-violet-100 bg-neutral-50 px-3 py-2 text-[10px] leading-snug text-neutral-700">
                {JSON.stringify(r.output, null, 2)}
              </pre>
            )}
          </div>
        );
      })}

      {payload.buildErrors && payload.buildErrors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          <strong className="font-semibold">Build note:</strong> {payload.buildErrors.join(" · ")}
        </div>
      )}
    </div>
  );
}
