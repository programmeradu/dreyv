"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeft, Check, Settings2, FlaskConical, Loader2 } from "lucide-react";
import { IntegrationLogo } from "../IntegrationLogo";

export interface PlanIntegration {
  id: string;
  name: string;
  description: string;
  category: string;
  status: "ready" | "needs_setup" | "researching";
  requiredEnv: string[];
  docsUrl?: string;
}

interface Props {
  integrations: PlanIntegration[];
  unknownProtocols: string[];
  isLoading?: boolean;
  onBack: () => void;
  onContinue: (chosen: PlanIntegration[]) => void;
}

export function IntegrationsStage({ integrations, unknownProtocols, isLoading, onBack, onContinue }: Props) {
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set());

  const toggle = (id: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const chosen = useMemo(
    () => integrations.filter((i) => enabled.has(i.id)),
    [integrations, enabled]
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
        <Loader2 size={20} className="animate-spin text-primary" />
        <span className="text-xs uppercase tracking-widest">Researching protocols…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] uppercase tracking-[0.25em] text-primary font-bold mb-1">
          Step 2 of 3 · Integrations
        </p>
        <h3 className="text-lg font-semibold text-foreground">Pick the real stack</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Only enabled integrations get wired. Anything marked researching is being learned from docs.
        </p>
      </div>

      {unknownProtocols.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-primary/20 bg-primary/5">
          <FlaskConical size={14} className="text-primary mt-0.5 shrink-0" />
          <div className="text-xs text-foreground">
            <span className="font-semibold text-primary">Researching: </span>
            {unknownProtocols.join(", ")} — Tavily + Firecrawl + Jina + Cloudflare Browser will fetch SDK docs before build.
          </div>
        </div>
      )}

      <div className="space-y-2">
        {integrations.map((it) => {
          const isOn = enabled.has(it.id);
          const statusBadge =
            it.status === "ready" ? (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-primary">
                <Check size={10} /> Ready
              </span>
            ) : it.status === "needs_setup" ? (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-[hsl(var(--warning,38_92%_50%))]">
                <Settings2 size={10} /> Needs setup
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-[hsl(var(--info,217_91%_60%))]">
                <FlaskConical size={10} /> Researching
              </span>
            );

          return (
            <button
              key={it.id}
              type="button"
              onClick={() => toggle(it.id)}
              className={`w-full text-left p-3 rounded-lg border transition-all ${
                isOn
                  ? "border-primary/50 bg-primary/5"
                  : "border-border bg-muted/20 hover:border-border/80"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <IntegrationLogo name={it.name} docsUrl={it.docsUrl} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-foreground">{it.name}</span>
                      {statusBadge}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{it.description}</p>
                    {it.requiredEnv.length > 0 && it.status === "needs_setup" && (
                      <p className="text-[10px] text-[hsl(var(--warning,38_92%_50%))] mt-1 font-mono">
                        requires: {it.requiredEnv.join(", ")}
                      </p>
                    )}
                  </div>
                </div>
                <div
                  className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                    isOn ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  }`}
                >
                  {isOn && <Check size={12} strokeWidth={3} />}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="pt-4 flex justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
          <ArrowLeft size={14} /> Back
        </Button>
        <Button onClick={() => onContinue(chosen)} size="sm" className="gap-2">
          Preview build plan
          <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}
