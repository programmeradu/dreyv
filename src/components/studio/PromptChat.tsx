"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowUp, Activity, Loader2, Cpu, Zap, Shield, AlertTriangle, ChevronDown } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { getAvatarUrl } from "@/lib/avatars";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSelf } from "@/liveblocks.config";
import { cn } from "@/lib/utils";
import { ArchitectEngine, type ArchitectStatus, type ArchitectState } from "@/lib/studio/architect-engine";
import { loadAIConfig, type AIKeyConfig } from "@/components/studio/APIKeySettings";

// ─── Types ──────────────────────────────────────────────────────────

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
    codeGenerated?: boolean;
    state?: ArchitectState;
}

interface PromptChatProps {
    onGenerate: (files: Record<string, string>) => void;
    isGenerating: boolean;
    setIsGenerating: (value: boolean) => void;
    userFiles: Record<string, any>;
    runtimeLogs?: string[];
}

// ─── State Label Map ────────────────────────────────────────────────

const STATE_LABELS: Record<ArchitectState, { label: string; color: string; icon: string }> = {
    IDLE: { label: "Idle", color: "text-slate-500", icon: "" },
    STREAMING: { label: "Generating", color: "text-violet-600", icon: "animate-pulse" },
    ANALYZING: { label: "Analyzing", color: "text-amber-600", icon: "" },
    CORRECTING: { label: "Self-correcting", color: "text-orange-600", icon: "animate-pulse" },
    RE_ANALYZING: { label: "Re-analyzing", color: "text-amber-600", icon: "" },
    CLEAN: { label: "Clean build", color: "text-emerald-600", icon: "" },
    FAILED: { label: "Errors remain", color: "text-rose-600", icon: "" },
};

// ─── Available Models ───────────────────────────────────────────────

interface ModelOption {
    id: string;
    label: string;
    provider: string;
    byok?: boolean;
}

const FREE_MODELS: ModelOption[] = [
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", provider: "groq" },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Fast", provider: "groq" },
    { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B", provider: "groq" },
    { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "CF Llama 3.3 70B", provider: "cloudflare" },
    { id: "@cf/qwen/qwen2.5-coder-32b-instruct", label: "Qwen 2.5 Coder 32B", provider: "cloudflare" },
    { id: "@cf/qwen/qwen3-30b-a3b-fp8", label: "Qwen 3 30B", provider: "cloudflare" },
];

const BYOK_MODELS: Record<string, ModelOption[]> = {
    openai: [
        { id: "gpt-4o", label: "GPT-4o", provider: "openai", byok: true },
        { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "openai", byok: true },
        { id: "o1", label: "o1", provider: "openai", byok: true },
        { id: "o3-mini", label: "o3-mini", provider: "openai", byok: true },
    ],
    google: [
        { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "google", byok: true },
        { id: "gemini-2.0-pro", label: "Gemini 2.0 Pro", provider: "google", byok: true },
    ],
    anthropic: [
        { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", provider: "anthropic", byok: true },
        { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", provider: "anthropic", byok: true },
        { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", provider: "anthropic", byok: true },
    ],
    groq: [
        { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (BYOK)", provider: "groq", byok: true },
    ],
    ollama: [
        { id: "qwen2.5-coder:7b", label: "Qwen2.5-Coder 7B", provider: "ollama", byok: true },
        { id: "qwen2.5-coder:32b", label: "Qwen2.5-Coder 32B", provider: "ollama", byok: true },
        { id: "codellama:7b", label: "CodeLlama 7B", provider: "ollama", byok: true },
    ],
};

// ─── Component ──────────────────────────────────────────────────────

export function PromptChat({ onGenerate, isGenerating, setIsGenerating, userFiles, runtimeLogs }: PromptChatProps) {
    const user = useSelf();
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<Message[]>([
        {
            id: "welcome",
            role: "assistant",
            content: "Hey — I'm the Dreyv Architect. Tell me what you want to build and I'll synthesize the modules, wire them to your treasury, and self-correct any errors before handing them back.",
            timestamp: new Date(),
        },
    ]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [useDeepResearch, setUseDeepResearch] = useState(false);
    const [architectStatus, setArchitectStatus] = useState<ArchitectStatus | null>(null);
    const engineRef = useRef<ArchitectEngine | null>(null);
    const [selectedModel, setSelectedModel] = useState("llama-3.3-70b-versatile");
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const [byokConfig, setByokConfig] = useState<AIKeyConfig | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Load BYOK config on mount
    useEffect(() => {
        try {
            const config = loadAIConfig();
            setByokConfig(config);
        } catch { /* no config */ }
    }, []);

    // Close model dropdown on outside click
    useEffect(() => {
        if (!showModelDropdown) return;
        const handleClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowModelDropdown(false);
            }
        };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [showModelDropdown]);

    // Build dynamic model list: BYOK models first (if configured), then free models
    const availableModels = useMemo(() => {
        const models: ModelOption[] = [];
        if (byokConfig?.apiKey && byokConfig.provider) {
            const byokModels = BYOK_MODELS[byokConfig.provider];
            if (byokModels) models.push(...byokModels);
        }
        models.push(...FREE_MODELS);
        return models;
    }, [byokConfig]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    // ─── Architect Engine Setup ─────────────────────────────
    const getEngine = useCallback(() => {
        if (!engineRef.current) {
            engineRef.current = new ArchitectEngine({
                onStateChange: (status) => {
                    setArchitectStatus({ ...status });
                },
                onFilesGenerated: (files) => {
                    onGenerate(files);
                },
                onExplanation: () => {
                    // Explanation handled via message update below
                },
                onError: (error) => {
                    console.error("[Architect]", error);
                },
            });
        }
        return engineRef.current;
    }, [onGenerate]);

    // ─── Submit Handler ─────────────────────────────────────
    const handleSubmit = async () => {
        if (!input.trim() || isGenerating) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            content: input.trim(),
            timestamp: new Date(),
        };

        setMessages((prev) => [...prev, userMessage]);
        setInput("");
        setIsGenerating(true);

        const thinkingId = (Date.now() + 1).toString();
        setMessages((prev) => [
            ...prev,
            {
                id: thinkingId,
                role: "assistant",
                content: useDeepResearch
                    ? "Initiating deep research protocol..."
                    : "Initializing self-correction pipeline...",
                timestamp: new Date(),
                state: "STREAMING",
            },
        ]);

        let researchContext = "";

        try {
            // ─── Deep Research (optional) ───────────────────
            if (useDeepResearch) {
                setMessages((prev) =>
                    prev.map((m) =>
                        m.id === thinkingId
                            ? { ...m, content: "Scanning decentralized protocols..." }
                            : m
                    )
                );

                try {
                    const researchRes = await fetch("/api/agent/knowledge", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ query: userMessage.content }),
                    });

                    if (researchRes.ok) {
                        const researchData = await researchRes.json();
                        researchContext = `\n\n[RESEARCH CONTEXT based on: ${researchData.query}]\nSummary: ${researchData.summary}\nTechnical Reference: ${researchData.rawContent}`;

                        setMessages((prev) =>
                            prev.map((m) =>
                                m.id === thinkingId
                                    ? {
                                        ...m,
                                        content: `Research complete. Synthesizing implementation...`,
                                    }
                                    : m
                            )
                        );
                    }
                } catch {
                    // Research failed — continue without it
                }
            }

            // ─── Run Architect Engine ───────────────────────
            const engine = getEngine();

            // Update engine callbacks for this generation run
            engine.updateCallbacks({
                onStateChange: (status: ArchitectStatus) => {
                    setArchitectStatus({ ...status });
                    const stateMsg = getStateMessage(status);
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === thinkingId
                                ? { ...m, content: stateMsg, state: status.state }
                                : m
                        )
                    );
                },
                onExplanation: (explanation: string) => {
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === thinkingId
                                ? {
                                    ...m,
                                    content: `Generation complete.\n\n${explanation}`,
                                    codeGenerated: true,
                                    state: "CLEAN",
                                }
                                : m
                        )
                    );
                },
                onFilesGenerated: (files: Record<string, string>) => {
                    const status = engine.getStatus();
                    const fileCount = Object.keys(files).length;
                    const wasClean = status.state === "CLEAN";

                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === thinkingId
                                ? {
                                    ...m,
                                    content: wasClean
                                        ? `${fileCount} module(s) synthesized. Clean build.${status.attempt > 0 ? ` (${status.attempt} correction(s) applied)` : ""}`
                                        : `${fileCount} module(s) generated with ${status.errors.length} remaining issue(s) after ${status.attempt} correction attempt(s).`,
                                    codeGenerated: true,
                                    state: status.state,
                                }
                                : m
                        )
                    );

                    onGenerate(files);
                },
                onError: (error: string) => {
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === thinkingId
                                ? {
                                    ...m,
                                    content: `Generation issue:\n${error}`,
                                    state: "FAILED",
                                }
                                : m
                        )
                    );
                },
            });

            const selectedModelInfo = availableModels.find(m => m.id === selectedModel);
            const isByok = selectedModelInfo?.byok && byokConfig?.apiKey;

            await engine.generate(
                userMessage.content,
                userFiles,
                runtimeLogs,
                researchContext || undefined,
                {
                    provider: selectedModelInfo?.provider || "groq",
                    apiKey: isByok ? byokConfig!.apiKey : "",
                    model: selectedModel,
                }
            );
        } catch (error) {
            console.error("PromptChat Error:", error);
            setMessages((prev) =>
                prev.map((m) =>
                    m.id === thinkingId
                        ? {
                            ...m,
                            content: `Generation failed.\n\n${error instanceof Error ? error.message : "Unknown error"}`,
                            state: "FAILED",
                        }
                        : m
                )
            );
        } finally {
            setIsGenerating(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 bg-white">
            {/* Status Bar */}
            {architectStatus && architectStatus.state !== "IDLE" && (
                <ArchitectStatusBar status={architectStatus} />
            )}

            {/* Messages */}
            <ScrollArea className="flex-1 px-4 py-5 scrollbar-thin min-h-0" ref={scrollRef}>
                <div className="space-y-4 max-w-2xl mx-auto">
                    {messages.map((message) => (
                        <div
                            key={message.id}
                            className={cn(
                                "flex gap-2.5 items-start",
                                message.role === "user" ? "justify-end" : "justify-start"
                            )}
                        >
                            {message.role === "assistant" && (
                                <div className="w-7 h-7 rounded-full bg-violet-50 border border-violet-100 flex items-center justify-center shrink-0 mt-0.5">
                                    <DreyvStar size={13} className="text-violet-600" />
                                </div>
                            )}
                            <div
                                className={cn(
                                    "max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                                    message.role === "user"
                                        ? "bg-violet-600 text-white rounded-tr-sm font-medium"
                                        : "bg-slate-50 text-slate-800 border border-slate-200/70 rounded-tl-sm",
                                    message.codeGenerated && "border-emerald-200 bg-emerald-50/60 text-emerald-900",
                                    message.state === "STREAMING" && "border-violet-200 bg-violet-50/60",
                                    message.state === "CORRECTING" && "border-orange-200 bg-orange-50/60",
                                    message.state === "FAILED" && "border-rose-200 bg-rose-50/60 text-rose-900"
                                )}
                                style={{ fontFamily: "Manrope, ui-sans-serif, system-ui" }}
                            >
                                <pre className="whitespace-pre-wrap font-sans m-0">
                                    {message.content}
                                </pre>
                            </div>
                            {message.role === "user" && (
                                <Avatar className="h-7 w-7 shrink-0 border border-slate-200 mt-0.5">
                                    <AvatarImage src={getAvatarUrl(user?.info?.name || "User")} />
                                    <AvatarFallback className="text-[9px] font-semibold bg-violet-100 text-violet-700">
                                        {user?.info?.name?.charAt(0) || "U"}
                                    </AvatarFallback>
                                </Avatar>
                            )}
                        </div>
                    ))}
                </div>
            </ScrollArea>

            {/* Sticky composer */}
            <div className="px-4 pb-4 pt-2 border-t border-slate-200/70 bg-gradient-to-b from-white to-slate-50/40">
                <div className="max-w-2xl mx-auto">
                    <div className="relative rounded-2xl border border-slate-200 bg-white shadow-[0_4px_20px_-8px_rgba(124,58,237,0.15)] focus-within:border-violet-300 focus-within:shadow-[0_4px_24px_-6px_rgba(124,58,237,0.25)] transition-all">
                        <Textarea
                            ref={textareaRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Describe what you want to build…"
                            disabled={isGenerating}
                            className="resize-none border-0 bg-transparent text-[13px] text-slate-800 placeholder:text-slate-400 focus-visible:ring-0 px-3.5 pt-3 pb-12 min-h-[88px] rounded-2xl"
                            rows={3}
                            style={{ fontFamily: "Manrope, ui-sans-serif, system-ui" }}
                        />

                        {/* Bottom toolbar inside composer */}
                        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                                {/* Model chip */}
                                <div className="relative" ref={dropdownRef}>
                                    <button
                                        onClick={() => setShowModelDropdown(!showModelDropdown)}
                                        className="flex items-center gap-1 px-2 h-7 rounded-md text-[10px] font-medium text-slate-600 hover:text-violet-700 bg-slate-50 hover:bg-violet-50 border border-slate-200 hover:border-violet-200 transition-colors"
                                    >
                                        {availableModels.find(m => m.id === selectedModel)?.label || selectedModel}
                                        <ChevronDown size={10} className={cn("transition-transform", showModelDropdown && "rotate-180")} />
                                    </button>
                                    {showModelDropdown && (
                                        <div className="absolute bottom-full left-0 mb-1.5 w-60 rounded-lg border border-slate-200 bg-white shadow-xl z-50 py-1 max-h-72 overflow-auto">
                                            {byokConfig?.apiKey && (
                                                <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-violet-600 border-b border-slate-100">
                                                    Your models ({byokConfig.provider})
                                                </div>
                                            )}
                                            {availableModels.map((model) => {
                                                const isFirstFree = model === FREE_MODELS[0] && byokConfig?.apiKey;
                                                return (
                                                    <React.Fragment key={model.id + (model.byok ? "-byok" : "")}>
                                                        {isFirstFree && (
                                                            <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 border-t border-slate-100 mt-0.5">
                                                                Free models
                                                            </div>
                                                        )}
                                                        <button
                                                            onClick={() => {
                                                                setSelectedModel(model.id);
                                                                setShowModelDropdown(false);
                                                            }}
                                                            className={cn(
                                                                "w-full text-left px-3 py-1.5 text-[11px] transition-colors flex items-center gap-2",
                                                                selectedModel === model.id
                                                                    ? "bg-violet-50 text-violet-700 font-medium"
                                                                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                                                            )}
                                                        >
                                                            <span className="flex-1">{model.label}</span>
                                                            {model.byok && (
                                                                <span className="text-[8px] text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded uppercase tracking-wider font-bold">key</span>
                                                            )}
                                                        </button>
                                                    </React.Fragment>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={() => setUseDeepResearch(!useDeepResearch)}
                                    title="Deep research"
                                    className={cn(
                                        "flex items-center gap-1 px-2 h-7 rounded-md text-[10px] font-medium border transition-colors",
                                        useDeepResearch
                                            ? "text-violet-700 bg-violet-50 border-violet-200"
                                            : "text-slate-500 hover:text-violet-700 bg-slate-50 hover:bg-violet-50 border-slate-200 hover:border-violet-200"
                                    )}
                                >
                                    <Cpu size={11} className={cn(useDeepResearch && "animate-pulse")} />
                                    Research
                                </button>
                            </div>

                            <Button
                                size="icon"
                                onClick={handleSubmit}
                                disabled={!input.trim() || isGenerating}
                                className="h-7 w-7 rounded-md bg-violet-600 hover:bg-violet-700 text-white disabled:bg-slate-200 disabled:text-slate-400"
                            >
                                {isGenerating ? (
                                    <Loader2 size={13} className="animate-spin" />
                                ) : (
                                    <ArrowUp size={13} />
                                )}
                            </Button>
                        </div>
                    </div>

                    <p className="text-[10px] text-slate-400 mt-2 text-center font-medium">
                        <Activity size={9} className="inline mr-1.5 text-violet-500" />
                        Architect Engine v2 · Self-correcting
                    </p>
                </div>
            </div>
        </div>
    );
}

// ─── Status Bar Sub-Component ───────────────────────────────────────

function ArchitectStatusBar({ status }: { status: ArchitectStatus }) {
    const info = STATE_LABELS[status.state];
    const elapsed = Math.round(status.elapsedMs / 1000);

    return (
        <div className="px-4 py-2 border-b border-slate-200/70 bg-gradient-to-r from-violet-50/40 via-white to-white flex items-center gap-3 text-[10px] font-medium shrink-0">
            <div className={cn("flex items-center gap-1.5", info.color)}>
                {(status.state === "STREAMING" || status.state === "CORRECTING") && (
                    <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                )}
                {status.state === "CLEAN" && <Zap size={10} />}
                {status.state === "FAILED" && <AlertTriangle size={10} />}
                {(status.state === "ANALYZING" || status.state === "RE_ANALYZING") && <Shield size={10} />}
                <span>{info.label}</span>
            </div>

            <div className="h-3 w-px bg-slate-200" />

            {status.attempt > 0 && (
                <>
                    <span className="text-orange-600">
                        Fix {status.attempt}/{status.maxAttempts}
                    </span>
                    <div className="h-3 w-px bg-slate-200" />
                </>
            )}

            <span className="text-slate-500">~{status.tokensGenerated.toLocaleString()} tok</span>
            <div className="h-3 w-px bg-slate-200" />
            <span className="text-slate-500">{elapsed}s</span>
            <span className="ml-auto text-slate-400 font-mono text-[9px]">{status.model}</span>
        </div>
    );
}

// ─── Helpers ────────────────────────────────────────────────────────

function getStateMessage(status: ArchitectStatus): string {
    switch (status.state) {
        case "STREAMING":
            return "Generating code...";
        case "ANALYZING":
            return "Analyzing generated code for errors...";
        case "CORRECTING":
            return `Self-correction attempt ${status.attempt}/${status.maxAttempts}...\nFixing: ${status.errors.slice(0, 2).join("; ")}`;
        case "RE_ANALYZING":
            return `Re-analyzing after correction ${status.attempt}...`;
        case "CLEAN":
            return "Clean build achieved.";
        case "FAILED":
            return `Self-correction exhausted. ${status.errors.length} issue(s) remain.`;
        default:
            return "Processing...";
    }
}
