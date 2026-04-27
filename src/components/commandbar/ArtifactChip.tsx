"use client";

/**
 * Phase 7A.6 — ArtifactChip
 *
 * Renders an agent-generated deliverable (PDF / CSV / ZIP / JSON) returned
 * by capabilities like `treasury_report_pdf`, `treasury_report_csv`, and
 * `audit_pack_generate`. Provides download + (for PDFs) inline preview.
 *
 * Pure presentation — uses the signed `ref` URL produced by uploadArtifact().
 * Brand: solid violet only, no gradients (per project memory).
 */

import * as React from "react";
import { Download, FileText, FileSpreadsheet, FileArchive, FileJson, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ArtifactDescriptor {
  id?: string;
  kind: "pdf" | "csv" | "zip" | "json";
  ref: string;            // signed URL
  filename: string;
  mime: string;
  bytes: number;
  expiresAt?: string;     // ISO
  path?: string;
}

export interface ArtifactChipProps {
  artifact: ArtifactDescriptor;
  className?: string;
}

const KIND_META: Record<
  ArtifactDescriptor["kind"],
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  pdf: { label: "PDF", Icon: FileText },
  csv: { label: "CSV", Icon: FileSpreadsheet },
  zip: { label: "ZIP", Icon: FileArchive },
  json: { label: "JSON", Icon: FileJson },
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatExpiry(iso?: string): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `expires in ${days}d`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `expires in ${hours}h`;
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `expires in ${mins}m`;
}

function previewUrl(ref: string): string {
  // Append inline=1 so the API serves Content-Disposition: inline.
  return ref.includes("?") ? `${ref}&inline=1` : `${ref}?inline=1`;
}

export function ArtifactChip({ artifact, className }: ArtifactChipProps) {
  const { Icon, label } = KIND_META[artifact.kind] ?? KIND_META.json;
  const expiry = formatExpiry(artifact.expiresAt);
  const canPreview = artifact.kind === "pdf";

  return (
    <div
      className={cn(
        "group grid w-full max-w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 overflow-hidden rounded-lg border border-violet-200 bg-white p-2 shadow-sm transition-colors hover:border-violet-400",
        className,
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-600 text-white">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-tight text-zinc-900" title={artifact.filename}>
            {artifact.filename}
          </p>
        </div>
        <p className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[11px] leading-tight text-zinc-500">
          <span className="shrink-0 rounded bg-violet-50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-700">
            {label}
          </span>
          <span className="truncate">{formatBytes(artifact.bytes)}
          {expiry ? ` · ${expiry}` : ""}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canPreview ? (
          <a
            href={previewUrl(artifact.ref)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-violet-200 bg-white text-violet-700 transition-colors hover:bg-violet-50"
            aria-label={`Preview ${artifact.filename}`}
            title="Preview"
          >
            <Eye className="h-3.5 w-3.5" />
          </a>
        ) : null}
        <a
          href={artifact.ref}
          download={artifact.filename}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-violet-600 text-white transition-colors hover:bg-violet-700"
          aria-label={`Download ${artifact.filename}`}
          title="Download"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

export interface ArtifactListProps {
  artifacts: ArtifactDescriptor[];
  className?: string;
}

export function ArtifactList({ artifacts, className }: ArtifactListProps) {
  if (!artifacts?.length) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {artifacts.map((a, i) => (
        <ArtifactChip key={a.id ?? `${a.path ?? a.filename}-${i}`} artifact={a} />
      ))}
    </div>
  );
}

/**
 * Best-effort extractor: pull artifact descriptors out of an arbitrary
 * capability output payload. Capabilities standardize on `output.artifacts: []`,
 * but some emit a single `output.artifact`. Returns [] if neither shape matches.
 */
export function extractArtifacts(output: unknown): ArtifactDescriptor[] {
  if (!output || typeof output !== "object") return [];
  const o = output as Record<string, unknown>;
  const arr = Array.isArray(o.artifacts) ? o.artifacts : null;
  const single = !arr && o.artifact && typeof o.artifact === "object" ? [o.artifact] : null;
  const candidates = (arr ?? single ?? []) as unknown[];
  return candidates.filter(isArtifact);
}

function isArtifact(v: unknown): v is ArtifactDescriptor {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.ref === "string" &&
    typeof o.filename === "string" &&
    typeof o.mime === "string" &&
    typeof o.bytes === "number" &&
    (o.kind === "pdf" || o.kind === "csv" || o.kind === "zip" || o.kind === "json")
  );
}

export default ArtifactChip;
