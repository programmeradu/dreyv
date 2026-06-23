"use client";

/**
 * ErrorAutoFix — Runtime error → 1-click AI fix loop (Ouroboros Integration).
 *
 * When a runtime error is caught in the LivePreview, this component captures it,
 * sends it to the AI Architect with the current code context, and presents a
 * suggested fix as a diff preview that can be applied with one click.
 *
 * [Phase 7] — Error Auto-Fix Loop
 */

import React, { useState, useCallback } from "react";
import { AlertTriangle, Loader2, Check, X, RotateCcw } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";

// ─── Types ──────────────────────────────────────────────────────────

interface ErrorAutoFixProps {
    /** The runtime error message from LivePreview */
    error: string;
    /** The current code that produced the error */
    code: string;
    /** Console logs for additional context */
    logs?: string[];
    /** Callback when user accepts the fix */
    onApplyFix: (fixedCode: string) => void;
    /** Callback to dismiss */
    onDismiss: () => void;
    /** AI endpoint for fix generation */
    aiEndpoint?: string;
}

interface FixState {
    phase: "idle" | "analyzing" | "ready" | "error";
    fixedCode: string | null;
    explanation: string | null;
    fixError: string | null;
}

// ─── Component ──────────────────────────────────────────────────────

export function ErrorAutoFix({
    error,
    code,
    logs = [],
    onApplyFix,
    onDismiss,
    aiEndpoint = "/api/ai/auto-fix",
}: ErrorAutoFixProps) {
    const [state, setState] = useState<FixState>({
        phase: "idle",
        fixedCode: null,
        explanation: null,
        fixError: null,
    });

    const requestFix = useCallback(async () => {
        setState({ phase: "analyzing", fixedCode: null, explanation: null, fixError: null });

        try {
            const res = await fetch(aiEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    error,
                    code,
                    logs: logs.slice(-20),
                    sdkHooks: [
                        "useVault", "useTurnkey", "useFetch", "AppEventBus",
                        "useEncryptedSecret", "useACEReport", "useAgentHandoff",
                        "useMCPClient", "useMCPServer", "useSIWS", "useJupiterSwap",
                        "useImpactReport", "useTaxForensics", "useYieldOptimizer",
                        "useGaslessTx",
                    ],
                }),
            });

            if (!res.ok) throw new Error(`AI returned ${res.status}`);

            const data = (await res.json()) as { fixedCode: string; explanation: string };
            setState({
                phase: "ready",
                fixedCode: data.fixedCode,
                explanation: data.explanation,
                fixError: null,
            });
        } catch (err) {
            setState({
                phase: "error",
                fixedCode: null,
                explanation: null,
                fixError: err instanceof Error ? err.message : "Fix generation failed",
            });
        }
    }, [error, code, logs, aiEndpoint]);

    return (
        <div className="bg-white border border-red-200 rounded-xl overflow-hidden shadow-sm">
            {/* Error Header */}
            <div className="flex items-start gap-3 p-4 bg-red-50 border-b border-red-100">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-red-700 mb-1">Runtime Error</h3>
                    <p className="text-xs text-red-700/90 font-mono break-words leading-relaxed">
                        {error}
                    </p>
                </div>
                <button onClick={onDismiss} className="p-1 hover:bg-red-100 rounded transition-colors shrink-0">
                    <X className="w-4 h-4 text-slate-500" />
                </button>
            </div>

            {/* AI Fix Section */}
            <div className="p-4 space-y-3 bg-white">
                {state.phase === "idle" && (
                    <button
                        onClick={requestFix}
                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-700 rounded-lg text-white text-sm font-bold transition-colors"
                    >
                        <DreyvStar size={16} />
                        Auto-Fix with AI Architect
                    </button>
                )}

                {state.phase === "analyzing" && (
                    <div className="flex items-center justify-center gap-2 py-4 text-violet-700 text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Analyzing error and generating fix…
                    </div>
                )}

                {state.phase === "ready" && state.fixedCode && (
                    <>
                        {state.explanation && (
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                                <h4 className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">
                                    AI Explanation
                                </h4>
                                <p className="text-xs text-slate-700 leading-relaxed">{state.explanation}</p>
                            </div>
                        )}

                        <div className="bg-violet-50/60 border border-violet-200 rounded-lg overflow-hidden">
                            <div className="px-3 py-1.5 bg-violet-100/70 text-[10px] text-violet-700 uppercase tracking-wider font-bold">
                                Suggested Fix
                            </div>
                            <pre className="p-3 text-xs font-mono text-slate-800 overflow-x-auto max-h-48 whitespace-pre-wrap leading-relaxed bg-white">
                                {state.fixedCode}
                            </pre>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => onApplyFix(state.fixedCode!)}
                                className="flex-1 flex items-center justify-center gap-2 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-white text-sm font-bold transition-colors"
                            >
                                <Check className="w-4 h-4" />
                                Apply Fix
                            </button>
                            <button
                                onClick={requestFix}
                                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 text-sm transition-colors"
                                title="Regenerate"
                            >
                                <RotateCcw className="w-4 h-4" />
                            </button>
                            <button
                                onClick={onDismiss}
                                className="px-3 py-2 text-slate-500 hover:text-slate-800 text-sm transition-colors"
                            >
                                Dismiss
                            </button>
                        </div>
                    </>
                )}

                {state.phase === "error" && (
                    <div className="space-y-2">
                        <p className="text-xs text-amber-700">{state.fixError}</p>
                        <button
                            onClick={requestFix}
                            className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 text-sm transition-colors"
                        >
                            <RotateCcw className="w-4 h-4" />
                            Retry
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
