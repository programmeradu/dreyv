"use client";

import { useState, useEffect, useCallback } from "react";
import { ClarifyStage, type ClarifyQuestion } from "./stages/ClarifyStage";
import { IntegrationsStage, type PlanIntegration } from "./stages/IntegrationsStage";
import { PlanPreviewStage } from "./stages/PlanPreviewStage";
import { Button } from "@/components/ui/button";
import { X, AlertCircle } from "lucide-react";

type Stage = "clarify" | "integrations" | "preview";

interface PlanStepperProps {
  prompt: string;
  onCancel: () => void;
  onBuild: (payload: {
    prompt: string;
    answers: Record<string, string | string[]>;
    chosenIntegrations: PlanIntegration[];
    researchContext: string;
    category: string;
    unknownProtocols: string[];
  }) => void;
  isBuilding?: boolean;
}

export function PlanStepper({ prompt, onCancel, onBuild, isBuilding }: PlanStepperProps) {
  const [stage, setStage] = useState<Stage>("clarify");
  const [error, setError] = useState<string | null>(null);

  const [questions, setQuestions] = useState<ClarifyQuestion[]>([]);
  const [loadingClarify, setLoadingClarify] = useState(true);

  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});

  const [planData, setPlanData] = useState<{
    integrations: PlanIntegration[];
    files: Array<{ path: string; purpose: string }>;
    dataSources: string[];
    onChainCalls: string[];
    unknownProtocols: string[];
    needsUserInput: string[];
    category: string;
  } | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [chosenIntegrations, setChosenIntegrations] = useState<PlanIntegration[]>([]);
  const [researchContext, setResearchContext] = useState<string>("");

  // ─── Stage 1: Fetch clarifying questions ────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingClarify(true);
      setError(null);
      try {
        const res = await fetch("/api/studio/clarify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "Clarify failed");
        setQuestions(data.questions || []);
        if (data.researchContext) setResearchContext(data.researchContext);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to start plan");
      } finally {
        if (!cancelled) setLoadingClarify(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prompt]);

  // ─── Stage 2: Fetch plan + research unknown protocols ──
  const fetchPlan = useCallback(async (a: Record<string, string | string[]>, priorResearch: string) => {
    setLoadingPlan(true);
    setError(null);
    try {
      const res = await fetch("/api/studio/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, answers: a, researchContext: priorResearch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Plan failed");

      let combinedResearch = priorResearch || "";
      if (Array.isArray(data.unknownProtocols) && data.unknownProtocols.length > 0) {
        const results = await Promise.allSettled(
          data.unknownProtocols.map((p: string) =>
            fetch("/api/studio/research", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ protocol: p, prompt }),
            }).then((r) => r.json())
          )
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value?.markdown) {
            combinedResearch += `\n\n[RESEARCH: ${r.value.protocol}]\n${r.value.markdown}`;
          }
        }
      }

      setResearchContext(combinedResearch);
      setPlanData({
        integrations: data.integrations || [],
        files: data.files || [],
        dataSources: data.dataSources || [],
        onChainCalls: data.onChainCalls || [],
        unknownProtocols: data.unknownProtocols || [],
        needsUserInput: data.needsUserInput || [],
        category: data.category || "other",
      });
      setStage("integrations");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build plan");
    } finally {
      setLoadingPlan(false);
    }
  }, [prompt]);

  const handleClarifySubmit = (a: Record<string, string | string[]>) => {
    setAnswers(a);
    fetchPlan(a, researchContext);
  };

  const handleIntegrationsContinue = (chosen: PlanIntegration[]) => {
    setChosenIntegrations(chosen);
    setStage("preview");
  };

  const handleBuild = () => {
    if (!planData) return;
    onBuild({
      prompt,
      answers,
      chosenIntegrations,
      researchContext,
      category: planData.category,
      unknownProtocols: planData.unknownProtocols,
    });
  };

    return (
        <div
            className="absolute inset-0 z-20 flex items-start justify-center overflow-y-auto"
            style={{
                background:
                    "radial-gradient(1200px 600px at 20% -10%, hsl(264 96% 96% / 0.9), transparent 60%)," +
                    "radial-gradient(800px 500px at 100% 100%, hsl(264 96% 92% / 0.55), transparent 60%)," +
                    "linear-gradient(180deg, hsl(40 60% 98%) 0%, hsl(40 50% 96%) 100%)",
            }}
        >
            <div className="w-full max-w-2xl px-6 py-10 mx-auto">
                {/* Header w/ prompt + cancel */}
                <div className="flex items-start justify-between gap-4 mb-6">
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500 font-bold mb-1">
                            Building
                        </p>
                        <p className="text-sm text-slate-900 line-clamp-2" style={{ fontFamily: "Manrope, ui-sans-serif, system-ui" }}>{prompt}</p>
                    </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="shrink-0 h-8 w-8 p-0 text-muted-foreground"
            disabled={isBuilding}
          >
            <X size={16} />
          </Button>
        </div>

        {/* Stepper indicator */}
        <div className="flex items-center gap-2 mb-8">
          {(["clarify", "integrations", "preview"] as Stage[]).map((s, i) => {
            const order = ["clarify", "integrations", "preview"];
            const currentIdx = order.indexOf(stage);
            const active = i <= currentIdx;
            return (
              <div key={s} className="flex-1 flex items-center gap-2">
                <div
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    active ? "bg-primary" : "bg-border"
                  }`}
                />
              </div>
            );
          })}
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          {stage === "clarify" && (
            <ClarifyStage
              questions={questions}
              isLoading={loadingClarify || loadingPlan}
              onSubmit={handleClarifySubmit}
            />
          )}
          {stage === "integrations" && planData && (
            <IntegrationsStage
              integrations={planData.integrations}
              unknownProtocols={planData.unknownProtocols}
              onBack={() => setStage("clarify")}
              onContinue={handleIntegrationsContinue}
            />
          )}
          {stage === "preview" && planData && (
            <PlanPreviewStage
              files={planData.files}
              dataSources={planData.dataSources}
              onChainCalls={planData.onChainCalls}
              needsUserInput={planData.needsUserInput}
              chosenIntegrations={chosenIntegrations}
              isBuilding={isBuilding}
              onBack={() => setStage("integrations")}
              onBuild={handleBuild}
            />
          )}
        </div>
      </div>
    </div>
  );
}
