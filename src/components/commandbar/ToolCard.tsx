"use client";

// Feature: commandbar-god-mode
// ToolCard — renders a single tool invocation part in the CommandBar chat thread.
// Covers Requirements 3.3, 3.4, 3.5, 18.6

import React from "react";
import Link from "next/link";
import { Loader2, CheckCircle2, AlertTriangle, ArrowUpRight } from "lucide-react";
import { TOOL_META } from "@/lib/commandbar/tool-meta";
import { useCommandBarSigningStore } from "@/lib/stores/commandbar-signing-store";
import { SigningCard } from "@/components/commandbar/SigningCard";
import { ForesightChart, type ForesightChartProps } from "@/components/commandbar/ForesightChart";
import { ArtifactList, extractArtifacts } from "@/components/commandbar/ArtifactChip";
import { StreamingProgress } from "@/components/commandbar/StreamingProgress";
import { ToolHeadline } from "@/components/commandbar/ToolHeadline";
import { ToolBody } from "@/components/commandbar/ToolBody";
import { AppEventBus } from "@/lib/events";

export interface ToolCardProps {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  state: "partial-call" | "call" | "output-available";
  output?: Record<string, unknown>;
  onSign: (
    toolCallId: string,
    serialized: string[],
    operation: string,
    extraSigners?: Array<Array<{ publicKey: string; secretKeyBase64: string }>>,
  ) => void;
}

export function ToolCard({
  toolName,
  toolCallId,
  state,
  output,
  onSign,
}: ToolCardProps) {
  const meta = TOOL_META[toolName] ?? {
    label: toolName,
    color: "text-zinc-400",
    icon: "🔧",
  };

  const { signingToolId, signingStatus, txSignatures } =
    useCommandBarSigningStore();

  const isLoading = state === "partial-call" || state === "call";
  const isDone = state === "output-available";
  const success = isDone ? (output?.success as boolean | undefined) : undefined;

  // Result summary text
  const resultSummary =
    isDone && success
      ? ((output?.message ?? output?.operation ?? "") as string)
      : undefined;

  const errorMessage =
    isDone && success === false
      ? ((output?.error ?? output?.message ?? "An error occurred.") as string)
      : undefined;

  // Signing fields
  const requiresApproval = isDone && output?.requiresApproval === true;
  const serializedTransactions: string[] = (() => {
    if (!requiresApproval) return [];
    if (Array.isArray(output?.serializedTransactions))
      return output.serializedTransactions as string[];
    if (typeof output?.serializedTransaction === "string")
      return [output.serializedTransaction as string];
    return [];
  })();
  // Ephemeral co-signers (e.g. Squads createKey) that must partial-sign each
  // tx before the wallet sees it. Either an array-of-arrays index-aligned with
  // serializedTransactions, or a flat array applied to every tx.
  const extraSignersFromOutput: Array<
    Array<{ publicKey: string; secretKeyBase64: string }>
  > = (() => {
    if (!requiresApproval) return [];
    const raw = (output as { extraSigners?: unknown })?.extraSigners;
    if (!Array.isArray(raw)) return [];
    if (raw.length === 0) return [];
    const isFlat =
      raw[0] &&
      typeof raw[0] === "object" &&
      typeof (raw[0] as { secretKeyBase64?: unknown }).secretKeyBase64 === "string";
    if (isFlat) {
      const flat = raw as Array<{ publicKey: string; secretKeyBase64: string }>;
      return serializedTransactions.map(() => flat);
    }
    return raw as Array<Array<{ publicKey: string; secretKeyBase64: string }>>;
  })();

  // Foresight visualization
  const triggerVisualization = isDone && output?.triggerVisualization === true;
  const chartType = (output?.chartType as ForesightChartProps["chartType"]) ?? "depletion_node";
  const monthlyProjection = Array.isArray(output?.monthlyProjection)
    ? (output.monthlyProjection as Array<Record<string, number>>)
    : [];

  const operation = (output?.operation ?? toolName) as string;

  const studioAppId =
    isDone &&
    success &&
    (toolName === "studio_init_miniapp" || operation === "studio_init_miniapp") &&
    typeof output?.appId === "string" &&
    output.appId.length > 0
      ? output.appId
      : null;
  const sourceTool =
    isDone && typeof output?.sourceTool === "string" ? output.sourceTool : null;
  const sourceField =
    isDone && typeof output?.sourceField === "string" ? output.sourceField : null;

  // ── Bridge artifacts + research brief into the Living Canvas ─────────
  // Fires once per tool completion; the Canvas de-dupes by id.
  const emittedRef = React.useRef(false);
  React.useEffect(() => {
    if (!isDone || success !== true || emittedRef.current) return;
    const artifacts = extractArtifacts(output);

    // Special-case: protocol research brief gets a richer block with insights
    // + suggestions ("how Dreyv can help your treasury") in addition to the file.
    if (
      (toolName === "protocol_research_brief" ||
        operation === "protocol_research_brief") &&
      output
    ) {
      const protocol = typeof output.protocol === "string" ? output.protocol : "Protocol";
      AppEventBus.emit("CANVAS_ADD_BLOCK", {
        id: `research-${toolCallId}`,
        type: "research-brief",
        source: "agent",
        origin: "/app",
        title: `Research: ${protocol}`,
        subtitle: typeof output.summary === "string" ? output.summary.slice(0, 120) : undefined,
        pinned: true,
        payload: {
          protocol,
          summary: output.summary,
          insights: output.insights,
          suggestions: output.suggestions,
          artifacts,
        },
      });
    } else if (artifacts.length > 0) {
      AppEventBus.emit("CANVAS_ADD_BLOCK", {
        id: `artifact-${toolCallId}`,
        type: "artifact",
        source: "agent",
        origin: "/app",
        title: artifacts[0].filename,
        subtitle: `${artifacts.length} deliverable${artifacts.length > 1 ? "s" : ""} from ${operation}`,
        pinned: true,
        payload: {
          artifacts,
          message: typeof output?.message === "string" ? output.message : undefined,
          operation,
        },
      });
    }
    emittedRef.current = true;
  }, [isDone, success, output, operation, toolName, toolCallId]);

  return (
    <div className="my-1.5 rounded-3xl border border-violet-100 bg-white px-3.5 py-3 font-manrope text-sm text-slate-900">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-violet-50 text-base leading-none text-violet-700">
          {meta.icon}
        </span>
        <span className="text-xs font-semibold tracking-tight text-violet-700">
          {meta.label}
        </span>
        <span className="truncate text-[11px] font-medium text-slate-400">{toolName}</span>

        {/* Status indicator — right side */}
        <div className="ml-auto flex items-center gap-1.5">
          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600" />}
          {isDone && success === true && (
            <CheckCircle2 className="h-4 w-4 text-violet-600" strokeWidth={2.25} />
          )}
          {isDone && success === false && (
            <AlertTriangle className="h-4 w-4 text-rose-500" strokeWidth={2.25} />
          )}
        </div>
      </div>

      {/* Streaming progress — phased violet sweep while the tool is running */}
      {isLoading && <StreamingProgress toolName={toolName} />}

      {/* Per-tool headline strip — big numbers/chips for the result */}
      {isDone && success === true && <ToolHeadline toolName={toolName} operation={operation} output={output} />}

      {/* Result body */}
      {isDone && success === true && resultSummary && (
        <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
          {resultSummary}
        </p>
      )}

      {isDone && success === false && errorMessage && (
        <p className="mt-1.5 text-xs leading-relaxed text-rose-600">
          {errorMessage}
        </p>
      )}

      {isDone && success === true && (sourceTool || sourceField) && (
        <p className="mt-1 text-[10px] text-slate-400">
          Evidence: {sourceTool ? <span className="font-mono text-slate-500">{sourceTool}</span> : "tool"}
          {sourceField ? <> · field <span className="font-mono text-slate-500">{sourceField}</span></> : null}
        </p>
      )}

      {studioAppId && (
        <div className="mt-2">
          <Link
            href={`/app/studio?appId=${encodeURIComponent(studioAppId)}`}
            className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700"
          >
            Open in Studio
            <ArrowUpRight className="h-3 w-3" />
          </Link>
          <p className="mt-1 text-[10px] text-slate-400">
            Loads this project via <span className="font-mono text-slate-500">appId</span>
          </p>
        </div>
      )}

      {/* Signing card */}
      {requiresApproval && serializedTransactions.length > 0 && (
        <SigningCard
          toolCallId={toolCallId}
          operation={operation}
          serializedTransactions={serializedTransactions}
          signingStatus={signingToolId === toolCallId ? signingStatus : "idle"}
          txSignatures={signingToolId === toolCallId ? txSignatures : []}
          onConfirm={() =>
            onSign(toolCallId, serializedTransactions, operation, extraSignersFromOutput)
          }
        />
      )}

      {/* Foresight chart */}
      {triggerVisualization && (
        <ForesightChart
          chartType={chartType}
          monthlyProjection={monthlyProjection}
          result={output ?? {}}
        />
      )}

      {/* Phase 7A — agent-generated artifacts (PDF / CSV / ZIP) */}
      {isDone && success === true && (() => {
        const artifacts = extractArtifacts(output);
        return artifacts.length > 0 ? (
          <div className="mt-2">
            <ArtifactList artifacts={artifacts} />
          </div>
        ) : null;
      })()}
    </div>
  );
}


