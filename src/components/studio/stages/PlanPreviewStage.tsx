"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, Hammer, FileCode, Database, Link2, AlertCircle, Loader2 } from "lucide-react";
import type { PlanIntegration } from "./IntegrationsStage";

interface Props {
  files: Array<{ path: string; purpose: string }>;
  dataSources: string[];
  onChainCalls: string[];
  needsUserInput: string[];
  chosenIntegrations: PlanIntegration[];
  isBuilding?: boolean;
  onBack: () => void;
  onBuild: () => void;
}

export function PlanPreviewStage({
  files,
  dataSources,
  onChainCalls,
  needsUserInput,
  chosenIntegrations,
  isBuilding,
  onBack,
  onBuild,
}: Props) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] uppercase tracking-[0.25em] text-primary font-bold mb-1">
          Step 3 of 3 · Plan preview
        </p>
        <h3 className="text-lg font-semibold text-foreground">Here's what will be built</h3>
      </div>

      {/* Files */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
          <FileCode size={12} /> Files
        </div>
        <div className="space-y-1 rounded-lg border border-border bg-muted/20 p-3">
          {files.map((f) => (
            <div key={f.path} className="flex items-start gap-2 text-xs">
              <span className="font-mono text-primary font-semibold shrink-0">{f.path}</span>
              <span className="text-muted-foreground">— {f.purpose}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Integrations */}
      {chosenIntegrations.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
            <Link2 size={12} /> Wired integrations
          </div>
          <div className="flex flex-wrap gap-2">
            {chosenIntegrations.map((i) => (
              <span
                key={i.id}
                className="text-xs px-2.5 py-1 rounded-full border border-primary/30 bg-primary/5 text-primary font-semibold"
              >
                {i.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Data sources */}
      {dataSources.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
            <Database size={12} /> Real data sources
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {dataSources.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-primary">›</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* On-chain calls */}
      {onChainCalls.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
            On-chain calls
          </div>
          <ul className="space-y-1 text-xs font-mono text-foreground/80">
            {onChainCalls.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-primary">›</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Needs your input */}
      {needsUserInput.length > 0 && (
        <div className="space-y-2 rounded-lg border border-[hsl(var(--warning,38_92%_50%))/30] bg-[hsl(var(--warning,38_92%_50%))/5] p-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-[hsl(var(--warning,38_92%_50%))]">
            <AlertCircle size={12} /> Needs your input
          </div>
          <ul className="space-y-1 text-xs text-foreground/90">
            {needsUserInput.map((n, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-[hsl(var(--warning,38_92%_50%))]">›</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pt-4 flex justify-between items-center">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={isBuilding} className="gap-2">
          <ArrowLeft size={14} /> Back
        </Button>
        <Button onClick={onBuild} disabled={isBuilding} size="sm" className="gap-2 font-semibold">
          {isBuilding ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Building…
            </>
          ) : (
            <>
              <Hammer size={14} />
              Build it
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
