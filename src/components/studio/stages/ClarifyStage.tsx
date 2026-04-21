"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2 } from "lucide-react";

export interface ClarifyQuestion {
  id: string;
  text: string;
  options: string[];
  multi: boolean;
}

interface Props {
  questions: ClarifyQuestion[];
  isLoading?: boolean;
  onSubmit: (answers: Record<string, string | string[]>) => void;
}

export function ClarifyStage({ questions, isLoading, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});

  const setAnswer = (qid: string, value: string, multi: boolean) => {
    setAnswers((prev) => {
      if (!multi) return { ...prev, [qid]: value };
      const arr = (prev[qid] as string[] | undefined) || [];
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      return { ...prev, [qid]: next };
    });
  };

  const isAnswered = (q: ClarifyQuestion) => {
    const a = answers[q.id];
    return q.multi ? Array.isArray(a) && a.length > 0 : !!a;
  };

  const allAnswered = questions.every(isAnswered);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
        <Loader2 size={20} className="animate-spin text-primary" />
        <span className="text-xs uppercase tracking-widest">Generating questions…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] uppercase tracking-[0.25em] text-primary font-bold mb-1">
          Step 1 of 3 · Clarify
        </p>
        <h3 className="text-lg font-semibold text-foreground">A few quick questions</h3>
      </div>

      {questions.map((q) => {
        const selected = answers[q.id];
        const selectedSet = new Set(Array.isArray(selected) ? selected : selected ? [selected] : []);
        return (
          <div key={q.id} className="space-y-2">
            <label className="text-sm font-medium text-foreground block">{q.text}</label>
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt) => {
                const active = selectedSet.has(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setAnswer(q.id, opt, q.multi)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-primary font-semibold"
                        : "border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {q.multi && (
              <p className="text-[10px] text-muted-foreground/70">Select one or more</p>
            )}
          </div>
        );
      })}

      <div className="pt-4 flex justify-end">
        <Button
          onClick={() => onSubmit(answers)}
          disabled={!allAnswered}
          size="sm"
          className="gap-2"
        >
          Build the plan
          <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}
