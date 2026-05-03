"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowUp, Loader2, Cpu, ChevronDown, MessageSquare, ListTree } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { cn } from "@/lib/utils";
import {
    ArchitectEngine,
    type ArchitectStatus,
    type ArchitectState,
    type ActivityEvent,
} from "@/lib/studio/architect-engine";
import { loadAIConfig, type AIKeyConfig } from "@/components/studio/APIKeySettings";
import { ArchitectActivityCard, type ActivityCard } from "@/components/studio/ArchitectActivityCard";
import { ArchitectTimeline, type TimelineItem } from "@/components/studio/ArchitectTimeline";

// ─── Types ──────────────────────────────────────────────────────────

type MessageBlock =
    | { type: "text"; content: string }
    | { type: "activity"; card: ActivityCard }
    | { type: "summary"; markdown: string }
    | { type: "followups"; chips: string[] };

interface Message {
    id: string;
    role: "user" | "assistant";
    timestamp: Date;
    blocks: MessageBlock[];
}

interface PromptChatProps {
    onGenerate: (files: Record<string, string>) => void;
    isGenerating: boolean;
    setIsGenerating: (value: boolean) => void;
    userFiles: Record<string, any>;
    runtimeLogs?: string[];
}

// ─── Available Models ───────────────────────────────────────────────

interface ModelOption {
    id: string;
    label: string;
    provider: string;
    byok?: boolean;
}

const FREE_MODELS: ModelOption[] = [
    // Lovable AI (managed key, routed via Supabase edge function — premium quality, free tier)
    { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash · Lovable", provider: "lovable" },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro · Lovable", provider: "lovable" },
    { id: "openai/gpt-5", label: "GPT-5 · Lovable", provider: "lovable" },
    { id: "openai/gpt-5-mini", label: "GPT-5 Mini · Lovable", provider: "lovable" },
    // Legacy free providers (kept for fallback / speed)
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B · Groq", provider: "groq" },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Fast · Groq", provider: "groq" },
    { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B · Groq", provider: "groq" },
    { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "CF Llama 3.3 70B", provider: "cloudflare" },
    { id: "@cf/qwen/qwen2.5-coder-32b-instruct", label: "Qwen 2.5 Coder 32B", provider: "cloudflare" },
    { id: "@cf/qwen/qwen3-30b-a3b-fp8", label: "Qwen 3 30B", provider: "cloudflare" },
];

// Models considered strong enough for full Build / deep research generation.
// Anything outside this list will be auto-upgraded when the user hits Build.
// Models strong enough to honor the §0 OUTPUT CONTRACT (premium styling on first render).
// Flash / Mini / Lite tier models are deliberately EXCLUDED — they emit bare HTML and
// must be auto-upgraded to GPT-5 for full Builds.
const STRONG_BUILD_MODELS = new Set<string>([
    "google/gemini-2.5-pro",
    "openai/gpt-5",
    "openai/gpt-5.2",
    "gpt-4o",
    "claude-sonnet-4-20250514",
    "claude-3-5-sonnet-20241022",
]);
const BUILD_UPGRADE_MODEL = { id: "openai/gpt-5", provider: "lovable" } as const;

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

// ─── Status Label ───────────────────────────────────────────────────

const STATUS_LABEL: Record<ArchitectState, string | null> = {
    IDLE: null,
    STREAMING: "Architect is thinking…",
    ANALYZING: "Analyzing generated code…",
    CORRECTING: "Self-correcting issues…",
    RE_ANALYZING: "Re-analyzing after fix…",
    CLEAN: null,
    FAILED: null,
};

// ─── Follow-up suggestions ──────────────────────────────────────────

function generateFollowUps(prompt: string): string[] {
    const p = prompt.toLowerCase();
    const out: string[] = [];
    if (p.includes("swap") || p.includes("jupiter")) {
        out.push("Add slippage settings", "Add token search", "Add transaction history");
    } else if (p.includes("wallet") || p.includes("portfolio")) {
        out.push("Add token filtering", "Add 24h price chart", "Add export to CSV");
    } else if (p.includes("nft")) {
        out.push("Add collection floor price", "Add rarity ranking", "Add listing button");
    } else {
        out.push("Make it dark mode", "Add a refresh button", "Add loading states");
    }
    return out;
}

// ─── Component ──────────────────────────────────────────────────────

export function PromptChat({ onGenerate, isGenerating, setIsGenerating, userFiles, runtimeLogs }: PromptChatProps) {
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<Message[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [useDeepResearch, setUseDeepResearch] = useState(false);
    const [architectStatus, setArchitectStatus] = useState<ArchitectStatus | null>(null);
    const engineRef = useRef<ArchitectEngine | null>(null);
    const [selectedModel, setSelectedModel] = useState("google/gemini-3-flash-preview");
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const [byokConfig, setByokConfig] = useState<AIKeyConfig | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [collapsedThinking, setCollapsedThinking] = useState<Record<string, boolean>>({});
    const [viewMode, setViewMode] = useState<"chat" | "timeline">("chat");

    useEffect(() => {
        try {
            const config = loadAIConfig();
            setByokConfig(config);
        } catch { /* no config */ }
    }, []);

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

    // Safety net: when generation stops, mark any lingering in-progress cards as done
    useEffect(() => {
        if (isGenerating) return;
        setMessages((prev) =>
            prev.map((m) => ({
                ...m,
                blocks: m.blocks.map((b) => {
                    if (b.type !== "activity") return b;
                    if ((b.card.kind === "analyzing" || b.card.kind === "fixing") && !(b.card as { done?: boolean }).done) {
                        return { ...b, card: { ...b.card, done: true } };
                    }
                    if (b.card.kind === "thinking" && !b.card.done) {
                        return { ...b, card: { ...b.card, done: true, collapsed: true } };
                    }
                    return b;
                }),
            }))
        );
    }, [isGenerating]);

    const getEngine = useCallback(() => {
        if (!engineRef.current) {
            engineRef.current = new ArchitectEngine({
                onStateChange: (status) => setArchitectStatus({ ...status }),
                onFilesGenerated: (files) => onGenerate(files),
                onExplanation: () => { /* handled via summary block */ },
                onError: (error) => console.error("[Architect]", error),
            });
        }
        return engineRef.current;
    }, [onGenerate]);

    const toggleThinking = useCallback((id: string) => {
        setCollapsedThinking((prev) => ({ ...prev, [id]: !prev[id] }));
    }, []);

    // Build conversation history (text-only, last 10 turns) for context
    const buildHistory = useCallback((): Array<{ role: string; content: string }> => {
        const turns: Array<{ role: string; content: string }> = [];
        for (const m of messages) {
            if (m.id === "welcome") continue;
            const text = m.blocks
                .map((b) => {
                    if (b.type === "text") return b.content;
                    if (b.type === "summary") return b.markdown;
                    return "";
                })
                .filter(Boolean)
                .join("\n");
            if (text) turns.push({ role: m.role, content: text });
        }
        return turns;
    }, [messages]);

    // ─── Submit Handler ─────────────────────────────────────
    const handleSubmit = async (overridePrompt?: string) => {
        const promptText = (overridePrompt ?? input).trim();
        if (!promptText || isGenerating) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            timestamp: new Date(),
            blocks: [{ type: "text", content: promptText }],
        };

        const history = buildHistory();

        setMessages((prev) => [...prev, userMessage]);
        setInput("");
        setIsGenerating(true);

        const assistantId = (Date.now() + 1).toString();
        const thinkingCardId = `${assistantId}-thinking`;

        // Seed assistant message with empty thinking card
        setMessages((prev) => [
            ...prev,
            {
                id: assistantId,
                role: "assistant",
                timestamp: new Date(),
                blocks: [
                    {
                        type: "activity",
                        card: { id: thinkingCardId, kind: "thinking", text: "", collapsed: false, done: false },
                    },
                ],
            },
        ]);

        // Helpers to mutate the assistant message
        const updateAssistant = (mutator: (blocks: MessageBlock[]) => MessageBlock[]) => {
            setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, blocks: mutator(m.blocks) } : m))
            );
        };

        const appendBlock = (block: MessageBlock) => {
            updateAssistant((blocks) => [...blocks, block]);
        };

        const appendThinking = (chunk: string) => {
            updateAssistant((blocks) =>
                blocks.map((b) =>
                    b.type === "activity" && b.card.id === thinkingCardId && b.card.kind === "thinking"
                        ? { ...b, card: { ...b.card, text: b.card.text + chunk } }
                        : b
                )
            );
        };

        const finishThinking = () => {
            updateAssistant((blocks) =>
                blocks.map((b) =>
                    b.type === "activity" && b.card.id === thinkingCardId && b.card.kind === "thinking"
                        ? { ...b, card: { ...b.card, done: true, collapsed: true } }
                        : b
                )
            );
            setCollapsedThinking((prev) => ({ ...prev, [thinkingCardId]: true }));
        };

        const finalizeProgressCards = () => {
            updateAssistant((blocks) =>
                blocks.map((b) => {
                    if (b.type !== "activity") return b;
                    if (b.card.kind === "analyzing" || b.card.kind === "fixing") {
                        return { ...b, card: { ...b.card, done: true } };
                    }
                    if (b.card.kind === "thinking" && !b.card.done) {
                        return { ...b, card: { ...b.card, done: true, collapsed: true } };
                    }
                    return b;
                })
            );
        };

        let summaryAccumulator = "";
        let summaryBlockExists = false;
        const appendSummary = (chunk: string) => {
            summaryAccumulator += chunk;
            if (!summaryBlockExists) {
                summaryBlockExists = true;
                appendBlock({ type: "summary", markdown: summaryAccumulator });
            } else {
                updateAssistant((blocks) =>
                    blocks.map((b, i) =>
                        i === blocks.length - 1 && b.type === "summary"
                            ? { type: "summary", markdown: summaryAccumulator }
                            : b
                    )
                );
            }
        };

        let researchContext = "";

        try {
            if (useDeepResearch) {
                const researchCardId = `${assistantId}-research-${Date.now()}`;
                // Build a stronger query for vague styling/UX prompts
                const lower = promptText.toLowerCase();
                const isVagueStyle = /\b(styl|design|theme|ui|ux|look|feel|modern|2025|2026)\b/.test(lower) && promptText.length < 80;
                const researchQuery = isVagueStyle
                    ? `${promptText} — modern web app UI design trends 2026, premium light SaaS aesthetics, tailwind patterns`
                    : promptText;

                appendBlock({
                    type: "activity",
                    card: { id: researchCardId, kind: "research", query: researchQuery, done: false },
                });

                const updateResearch = (patch: Partial<Extract<ActivityCard, { kind: "research" }>>) => {
                    updateAssistant((blocks) =>
                        blocks.map((b) =>
                            b.type === "activity" && b.card.id === researchCardId && b.card.kind === "research"
                                ? { ...b, card: { ...b.card, ...patch } }
                                : b
                        )
                    );
                };

                try {
                    const researchRes = await fetch("/api/agent/knowledge", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ query: researchQuery }),
                    });
                    if (researchRes.ok) {
                        const data = await researchRes.json();
                        researchContext = `\n\n[RESEARCH CONTEXT based on: ${data.query}]\nSummary: ${data.summary}\nTechnical Reference: ${data.rawContent}`;
                        updateResearch({
                            done: true,
                            sources: data.sources || [],
                            summary: data.summary,
                            error: (!data.sources || data.sources.length === 0)
                                ? "No external sources found — proceeding with built-in knowledge."
                                : undefined,
                        });
                    } else {
                        updateResearch({ done: true, error: `Research API returned ${researchRes.status}` });
                    }
                } catch (err) {
                    updateResearch({ done: true, error: err instanceof Error ? err.message : "Research failed" });
                }
            }

            const engine = getEngine();

            engine.updateCallbacks({
                onStateChange: (status) => setArchitectStatus({ ...status }),
                onActivity: (event: ActivityEvent) => {
                    switch (event.kind) {
                        case "thinking_started":
                            // Already seeded
                            break;
                        case "thinking_chunk":
                            appendThinking(event.content);
                            break;
                        case "thinking_done":
                            finishThinking();
                            break;
                        case "file_added":
                            appendBlock({
                                type: "activity",
                                card: {
                                    id: `${assistantId}-${event.file}-add`,
                                    kind: "file_added",
                                    file: event.file,
                                    lines: event.lines,
                                },
                            });
                            break;
                        case "file_modified":
                            appendBlock({
                                type: "activity",
                                card: {
                                    id: `${assistantId}-${event.file}-mod`,
                                    kind: "file_modified",
                                    file: event.file,
                                    addedLines: event.addedLines,
                                    removedLines: event.removedLines,
                                },
                            });
                            break;
                        case "analyzing":
                            appendBlock({
                                type: "activity",
                                card: {
                                    id: `${assistantId}-analyze-${Date.now()}`,
                                    kind: "analyzing",
                                    fileCount: event.fileCount,
                                },
                            });
                            break;
                        case "issues_found":
                            appendBlock({
                                type: "activity",
                                card: {
                                    id: `${assistantId}-issues-${Date.now()}`,
                                    kind: "issues_found",
                                    count: event.count,
                                    preview: event.preview,
                                },
                            });
                            break;
                        case "fixing":
                            appendBlock({
                                type: "activity",
                                card: {
                                    id: `${assistantId}-fix-${event.attempt}`,
                                    kind: "fixing",
                                    attempt: event.attempt,
                                    max: event.max,
                                    issues: event.issues,
                                },
                            });
                            break;
                        case "summary_chunk":
                            appendSummary(event.content);
                            break;
                        case "done":
                            finishThinking();
                            finalizeProgressCards();
                            appendBlock({
                                type: "activity",
                                card: {
                                    id: `${assistantId}-done`,
                                    kind: "done",
                                    fileCount: event.fileCount,
                                    bytes: event.bytes,
                                    elapsedMs: event.elapsedMs,
                                    model: event.model,
                                    provider: event.provider,
                                    tokens: event.tokens,
                                },
                            });
                            // Add follow-up chips
                            appendBlock({ type: "followups", chips: generateFollowUps(promptText) });
                            break;
                        case "failed":
                            finishThinking();
                            finalizeProgressCards();
                            appendBlock({
                                type: "activity",
                                card: {
                                    id: `${assistantId}-error`,
                                    kind: "error",
                                    error: event.error,
                                },
                            });
                            break;
                    }
                },
                onSummary: (markdown: string) => {
                    if (!summaryBlockExists && markdown) {
                        appendSummary(markdown);
                    }
                },
                onExplanation: (explanation: string) => {
                    // Fallback: if model didn't emit a markdown summary, use the JSON `explanation`
                    if (!summaryBlockExists && explanation) {
                        appendBlock({ type: "summary", markdown: explanation });
                        summaryBlockExists = true;
                    }
                },
                onFilesGenerated: (files: Record<string, string>) => {
                    onGenerate(files);
                },
                onError: (error: string) => {
                    console.error("[Architect]", error);
                },
            });

            const selectedModelInfo = availableModels.find((m) => m.id === selectedModel);
            const isByok = selectedModelInfo?.byok && byokConfig?.apiKey;

            // Auto-upgrade: when the user runs a full Build (Deep Research on, or no
            // existing files yet) with a weak model, route through Lovable AI's
            // strongest model so styling + reasoning quality stay high.
            const isFullBuild = useDeepResearch || Object.keys(userFiles || {}).length === 0;
            let effectiveProvider = selectedModelInfo?.provider || "lovable";
            let effectiveModel = selectedModel;
            let effectiveApiKey = isByok ? byokConfig!.apiKey : "";
            if (isFullBuild && !STRONG_BUILD_MODELS.has(selectedModel) && !isByok) {
                effectiveProvider = BUILD_UPGRADE_MODEL.provider;
                effectiveModel = BUILD_UPGRADE_MODEL.id;
                effectiveApiKey = "";
                console.log(`[PromptChat] Auto-upgraded build → ${effectiveProvider}/${effectiveModel}`);
            }

            await engine.generate(
                promptText,
                userFiles,
                runtimeLogs,
                researchContext || undefined,
                {
                    provider: effectiveProvider,
                    apiKey: effectiveApiKey,
                    model: effectiveModel,
                },
                history
            );
        } catch (error) {
            console.error("PromptChat Error:", error);
            appendBlock({
                type: "activity",
                card: {
                    id: `${assistantId}-fatal`,
                    kind: "error",
                    error: error instanceof Error ? error.message : "Unknown error",
                },
            });
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

    const liveStatusLabel = architectStatus ? STATUS_LABEL[architectStatus.state] : null;

    // Derive timeline items from messages (flatten user prompts + activity cards in chronological order)
    const timelineItems: TimelineItem[] = useMemo(() => {
        const items: TimelineItem[] = [];
        for (const m of messages) {
            if (m.id === "welcome") continue;
            const baseTs = m.timestamp.getTime();
            m.blocks.forEach((block, i) => {
                const ts = baseTs + i;
                if (block.type === "text") {
                    items.push({
                        id: `${m.id}-text-${i}`,
                        kind: "narration",
                        role: m.role,
                        text: block.content,
                        timestamp: ts,
                    });
                } else if (block.type === "summary") {
                    items.push({
                        id: `${m.id}-sum-${i}`,
                        kind: "narration",
                        role: "assistant",
                        text: block.markdown,
                        timestamp: ts,
                    });
                } else if (block.type === "activity") {
                    items.push({
                        id: `${m.id}-act-${i}`,
                        kind: "activity",
                        card: block.card,
                        timestamp: ts,
                    });
                }
            });
        }
        return items;
    }, [messages]);

    const hasErrors = useMemo(
        () => (runtimeLogs || []).some((l) => l.startsWith("[error]")),
        [runtimeLogs]
    );

    const isEmpty = messages.length === 0;

    return (
        <div className="flex flex-col h-full min-h-0 min-w-0 w-full overflow-hidden bg-white">
            {/* Subtle live status — only when working */}
            {isGenerating && liveStatusLabel && (
                <div className="flex items-center gap-2 px-4 py-1.5 border-b border-violet-100 bg-violet-50/40 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-600 animate-pulse" />
                    <span className="text-[11px] font-medium text-violet-700">{liveStatusLabel}</span>
                    <button
                        onClick={() => setViewMode((v) => (v === "chat" ? "timeline" : "chat"))}
                        className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-violet-600/70 hover:text-violet-700 transition-colors"
                        title="Toggle timeline view"
                    >
                        {viewMode === "chat" ? <ListTree size={11} /> : <MessageSquare size={11} />}
                        <span className="uppercase tracking-wider">{viewMode === "chat" ? "Timeline" : "Chat"}</span>
                    </button>
                </div>
            )}

            {viewMode === "timeline" ? (
                <div className="flex-1 min-h-0">
                    <ArchitectTimeline
                        items={timelineItems}
                        isLive={isGenerating}
                        currentAction={liveStatusLabel}
                    />
                </div>
            ) : isEmpty ? (
                /* Clean empty-state — no welcome wall */
                <div className="flex-1 flex flex-col items-center justify-center px-6 text-center min-h-0">
                    <div className="w-10 h-10 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center mb-3">
                        <DreyvStar size={16} className="text-violet-600" />
                    </div>
                    <h3 className="text-[15px] font-semibold text-slate-900 tracking-tight">
                        What are we building?
                    </h3>
                    <p className="text-[12px] text-slate-500 mt-1 max-w-[260px] leading-relaxed">
                        Describe a mini-app and I'll plan it, write the code, and run it.
                    </p>
                </div>
            ) : (
                /* Messages */
                <ScrollArea className="flex-1 px-3 py-3 scrollbar-thin min-h-0 min-w-0 [&_[data-radix-scroll-area-viewport]]:!overflow-x-hidden" ref={scrollRef}>
                    <div className="space-y-3 min-w-0 break-words">

                        {messages.map((message) => (
                            <div
                                key={message.id}
                                className={cn(
                                    "flex w-full min-w-0",
                                    message.role === "user" ? "justify-end" : "justify-start"
                                )}
                            >
                                <div className={cn("flex flex-col gap-2 min-w-0", message.role === "user" ? "max-w-[88%]" : "w-full")}>
                                    {message.blocks.map((block, idx) => {
                                        if (block.type === "text") {
                                            return (
                                                <div
                                                    key={idx}
                                                    className={cn(
                                                        "text-[13px] leading-relaxed",
                                                        message.role === "user"
                                                            ? "rounded-2xl px-3.5 py-2 bg-violet-600 text-white font-medium"
                                                            : "text-slate-700"
                                                    )}
                                                >
                                                    <div className={cn(
                                                        "prose prose-sm max-w-none [&_p]:my-0 [&_p]:leading-relaxed",
                                                        message.role === "user" ? "prose-invert" : ""
                                                    )}>
                                                        <ReactMarkdown>{block.content}</ReactMarkdown>
                                                    </div>
                                                </div>
                                            );
                                        }
                                        if (block.type === "activity") {
                                            const card =
                                                block.card.kind === "thinking"
                                                    ? { ...block.card, collapsed: collapsedThinking[block.card.id] ?? block.card.collapsed }
                                                    : block.card;
                                            return (
                                                <ArchitectActivityCard
                                                    key={idx}
                                                    card={card}
                                                    onToggleThinking={toggleThinking}
                                                />
                                            );
                                        }
                                        if (block.type === "summary") {
                                            return (
                                                <div
                                                    key={idx}
                                                    className="rounded-xl px-3.5 py-3 text-[13px] leading-relaxed bg-violet-50/60 border border-violet-100"
                                                >
                                                    <div className="prose prose-sm max-w-none [&_p]:my-1 [&_ul]:my-1.5 [&_ul]:pl-4 [&_li]:my-0.5 [&_strong]:text-violet-700 [&_code]:text-violet-700 [&_code]:bg-violet-100/60 [&_code]:px-1 [&_code]:rounded">
                                                        <ReactMarkdown>{block.markdown}</ReactMarkdown>
                                                    </div>
                                                </div>
                                            );
                                        }
                                        if (block.type === "followups") {
                                            return (
                                                <div key={idx} className="flex flex-wrap gap-1.5 pt-0.5">
                                                    {block.chips.map((chip, i) => (
                                                        <button
                                                            key={i}
                                                            onClick={() => handleSubmit(chip)}
                                                            disabled={isGenerating}
                                                            className="text-[11px] px-2.5 py-1 rounded-full border border-violet-100 bg-white text-slate-600 hover:text-violet-700 hover:border-violet-300 hover:bg-violet-50 transition-colors flex items-center gap-1 disabled:opacity-50"
                                                        >
                                                            <DreyvStar size={10} className="text-violet-500" />
                                                            {chip}
                                                        </button>
                                                    ))}
                                                </div>
                                            );
                                        }
                                        return null;
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            )}

            {/* Input */}
            <div className="p-3 border-t border-slate-200/70 bg-white shrink-0">
                {/* Quick actions row — only show contextual chips */}
                {hasErrors && !isGenerating && (
                    <div className="flex items-center gap-1.5 mb-2">
                        <button
                            onClick={() => handleSubmit("Fix the runtime errors shown in the console.")}
                            className="text-[11px] px-2.5 py-1 rounded-full border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors flex items-center gap-1 font-semibold"
                        >
                            <DreyvStar size={10} />
                            Fix errors
                        </button>
                        <span className="text-[10px] text-slate-400">runtime issues detected</span>
                    </div>
                )}

                <div className="relative">
                    <Textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Describe what you want to build, or ask a follow-up…"
                        disabled={isGenerating}
                        className="resize-none pr-11 min-h-[68px] bg-slate-50/60 border-slate-200 focus-visible:border-violet-300 focus-visible:ring-violet-200/40 pl-3 pb-9 text-[13px] rounded-xl"
                        rows={2}
                    />

                    <Button
                        size="icon"
                        className="absolute bottom-2 right-2 h-7 w-7 rounded-lg bg-violet-600 hover:bg-violet-700 text-white"
                        onClick={() => handleSubmit()}
                        disabled={!input.trim() || isGenerating}
                    >
                        {isGenerating ? (
                            <Loader2 size={13} className="animate-spin" />
                        ) : (
                            <ArrowUp size={13} />
                        )}
                    </Button>

                    {/* Bottom-left controls: deep research + model */}
                    <div className="absolute bottom-2 left-2 flex items-center gap-1.5 z-10">
                        <button
                            onClick={() => setUseDeepResearch(!useDeepResearch)}
                            title="Deep Research"
                            className={cn(
                                "flex items-center gap-1 px-1.5 h-6 rounded-md text-[10px] font-semibold transition-colors border",
                                useDeepResearch
                                    ? "bg-violet-50 text-violet-700 border-violet-200"
                                    : "text-slate-500 hover:text-slate-700 border-slate-200 bg-white"
                            )}
                        >
                            <Cpu size={11} className={cn(useDeepResearch && "animate-pulse")} />
                            <span>Research</span>
                        </button>

                        <div className="relative" ref={dropdownRef}>
                            <button
                                onClick={() => setShowModelDropdown(!showModelDropdown)}
                                className="flex items-center gap-1 px-1.5 h-6 rounded-md text-[10px] font-medium text-slate-600 hover:text-slate-800 bg-white border border-slate-200 hover:border-slate-300 transition-colors"
                            >
                                <span className="font-mono">{availableModels.find((m) => m.id === selectedModel)?.label || selectedModel}</span>
                                <ChevronDown size={9} className={cn("transition-transform", showModelDropdown && "rotate-180")} />
                            </button>

                            {showModelDropdown && (
                                <div className="absolute bottom-full left-0 mb-1 w-56 rounded-lg border border-slate-200 bg-white shadow-lg z-50 py-1 max-h-64 overflow-auto">
                                    {byokConfig?.apiKey && (
                                        <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-violet-600/70 border-b border-slate-100 mb-0.5">
                                            Your Models ({byokConfig.provider})
                                        </div>
                                    )}
                                    {availableModels.map((model) => {
                                        const isFirstFree = model === FREE_MODELS[0] && byokConfig?.apiKey;
                                        return (
                                            <React.Fragment key={model.id + (model.byok ? "-byok" : "")}>
                                                {isFirstFree && (
                                                    <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-400 border-t border-slate-100 mt-0.5">
                                                        Free Models
                                                    </div>
                                                )}
                                                <button
                                                    onClick={() => {
                                                        setSelectedModel(model.id);
                                                        setShowModelDropdown(false);
                                                    }}
                                                    className={cn(
                                                        "w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors flex items-center gap-2",
                                                        selectedModel === model.id
                                                            ? "bg-violet-50 text-violet-700"
                                                            : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                                                    )}
                                                >
                                                    <span className="flex-1">{model.label}</span>
                                                    {model.byok && (
                                                        <span className="text-[8px] text-violet-700 bg-violet-100 px-1 py-0.5 rounded uppercase tracking-wider font-bold">key</span>
                                                    )}
                                                </button>
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
