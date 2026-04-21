"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowUp, Activity, Loader2, Cpu, ChevronDown, Sparkles, MessageSquare, ListTree } from "lucide-react";
import { ArchitectIcon } from "@/components/icons";
import { getAvatarUrl } from "@/lib/avatars";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSelf } from "@/liveblocks.config";
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
    const user = useSelf();
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<Message[]>([
        {
            id: "welcome",
            role: "assistant",
            timestamp: new Date(),
            blocks: [
                {
                    type: "text",
                    content:
                        "Hey 👋 — I'm the Architect. Tell me what you want to build and I'll plan it, write the code, fix any errors, and explain what I shipped. Try something like *\"a Jupiter swap UI for SOL → USDC\"*.",
                },
            ],
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
                try {
                    const researchRes = await fetch("/api/agent/knowledge", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ query: promptText }),
                    });
                    if (researchRes.ok) {
                        const data = await researchRes.json();
                        researchContext = `\n\n[RESEARCH CONTEXT based on: ${data.query}]\nSummary: ${data.summary}\nTechnical Reference: ${data.rawContent}`;
                    }
                } catch { /* continue without research */ }
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

            await engine.generate(
                promptText,
                userFiles,
                runtimeLogs,
                researchContext || undefined,
                {
                    provider: selectedModelInfo?.provider || "groq",
                    apiKey: isByok ? byokConfig!.apiKey : "",
                    model: selectedModel,
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

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* View mode toggle */}
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/40 shrink-0">
                <button
                    onClick={() => setViewMode("chat")}
                    className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-colors",
                        viewMode === "chat"
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                    )}
                >
                    <MessageSquare size={11} />
                    Chat
                </button>
                <button
                    onClick={() => setViewMode("timeline")}
                    className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-colors",
                        viewMode === "timeline"
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                    )}
                >
                    <ListTree size={11} />
                    Timeline
                </button>
                {isGenerating && (
                    <span className="ml-auto flex items-center gap-1.5 text-[10px] text-primary">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                        <span className="font-mono">{liveStatusLabel || "Working"}</span>
                    </span>
                )}
            </div>

            {viewMode === "timeline" ? (
                <div className="flex-1 min-h-0">
                    <ArchitectTimeline
                        items={timelineItems}
                        isLive={isGenerating}
                        currentAction={liveStatusLabel}
                    />
                </div>
            ) : (
            /* Messages */
            <ScrollArea className="flex-1 p-3 scrollbar-thin min-h-0" ref={scrollRef}>
                <div className="space-y-4">
                    {messages.map((message) => (
                        <div
                            key={message.id}
                            className={cn(
                                "flex gap-2",
                                message.role === "user" ? "justify-end" : "justify-start"
                            )}
                        >
                            {message.role === "assistant" && (
                                <div className="w-6 h-6 flex items-center justify-center shrink-0 mt-1">
                                    <ArchitectIcon size={14} />
                                </div>
                            )}

                            <div className={cn("flex flex-col gap-2", message.role === "user" ? "max-w-[88%]" : "max-w-[92%] flex-1")}>
                                {message.blocks.map((block, idx) => {
                                    if (block.type === "text") {
                                        return (
                                            <div
                                                key={idx}
                                                className={cn(
                                                    "rounded-xl px-4 py-2.5 text-[13px] leading-relaxed shadow-sm",
                                                    message.role === "user"
                                                        ? "bg-primary text-background font-bold tracking-tight"
                                                        : "bg-muted/20 text-foreground border border-border/40"
                                                )}
                                            >
                                                <div className="prose prose-sm prose-invert max-w-none [&_p]:my-0 [&_p]:leading-relaxed [&_strong]:text-foreground [&_em]:text-muted-foreground">
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
                                                className="rounded-xl px-4 py-3 text-[13px] leading-relaxed bg-primary/5 border border-primary/30"
                                            >
                                                <div className="prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1.5 [&_ul]:pl-4 [&_li]:my-0.5 [&_strong]:text-primary [&_code]:text-primary [&_code]:bg-primary/10 [&_code]:px-1 [&_code]:rounded">
                                                    <ReactMarkdown>{block.markdown}</ReactMarkdown>
                                                </div>
                                            </div>
                                        );
                                    }
                                    if (block.type === "followups") {
                                        return (
                                            <div key={idx} className="flex flex-wrap gap-1.5 pt-1">
                                                {block.chips.map((chip, i) => (
                                                    <button
                                                        key={i}
                                                        onClick={() => handleSubmit(chip)}
                                                        disabled={isGenerating}
                                                        className="text-[11px] px-2.5 py-1 rounded-full border border-border/60 bg-muted/20 text-muted-foreground hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-colors flex items-center gap-1 disabled:opacity-50"
                                                    >
                                                        <Sparkles size={10} />
                                                        {chip}
                                                    </button>
                                                ))}
                                            </div>
                                        );
                                    }
                                    return null;
                                })}
                            </div>

                            {message.role === "user" && (
                                <Avatar className="h-6 w-6 shrink-0 border border-border mt-1">
                                    <AvatarImage src={getAvatarUrl(user?.info?.name || "User")} />
                                    <AvatarFallback className="text-[8px] font-bold">
                                        {user?.info?.name?.charAt(0) || "U"}
                                    </AvatarFallback>
                                </Avatar>
                            )}
                        </div>
                    ))}

                    {/* Live status row (chat-integrated, replaces status bar) */}
                    {isGenerating && liveStatusLabel && (
                        <div className="flex gap-2 justify-start">
                            <div className="w-6 h-6 flex items-center justify-center shrink-0">
                                <Loader2 size={12} className="animate-spin text-primary" />
                            </div>
                            <div className="text-[12px] text-muted-foreground italic flex items-center">
                                {liveStatusLabel}
                                <span className="inline-flex ml-1">
                                    <span className="animate-pulse">.</span>
                                    <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>.</span>
                                    <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>.</span>
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </ScrollArea>
            )}

            {/* Input */}
            <div className="p-3 border-t border-border">
                <div className="relative">
                    <Textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Describe what you want to build, or ask a follow-up…"
                        disabled={isGenerating}
                        className="resize-none pr-12 min-h-[80px] bg-background/50 pl-12 pb-10"
                        rows={3}
                    />

                    <Button
                        size="icon"
                        variant="ghost"
                        className={cn(
                            "absolute top-2 left-2 h-8 w-8 transition-colors",
                            useDeepResearch ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
                        )}
                        onClick={() => setUseDeepResearch(!useDeepResearch)}
                        title="Enable Deep Research"
                    >
                        <Cpu size={16} className={cn(useDeepResearch && "animate-pulse")} />
                    </Button>
                    <Button
                        size="icon"
                        className="absolute bottom-2 right-2 h-8 w-8"
                        onClick={() => handleSubmit()}
                        disabled={!input.trim() || isGenerating}
                    >
                        {isGenerating ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <ArrowUp size={14} />
                        )}
                    </Button>

                    {/* Model selector */}
                    <div className="absolute bottom-2 left-2 z-10" ref={dropdownRef}>
                        <div className="relative">
                            <button
                                onClick={() => setShowModelDropdown(!showModelDropdown)}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono text-muted-foreground hover:text-foreground transition-colors bg-muted/40 hover:bg-muted/70 border border-border/30"
                            >
                                {availableModels.find((m) => m.id === selectedModel)?.label || selectedModel}
                                <ChevronDown size={8} className={cn("transition-transform", showModelDropdown && "rotate-180")} />
                            </button>

                            {showModelDropdown && (
                                <div className="absolute bottom-full left-0 mb-1 w-56 rounded-md border border-border bg-popover shadow-lg z-50 py-1 max-h-64 overflow-auto">
                                    {byokConfig?.apiKey && (
                                        <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-purple-400/60 border-b border-border/30 mb-0.5">
                                            Your Models ({byokConfig.provider})
                                        </div>
                                    )}
                                    {availableModels.map((model) => {
                                        const isFirstFree = model === FREE_MODELS[0] && byokConfig?.apiKey;
                                        return (
                                            <React.Fragment key={model.id + (model.byok ? "-byok" : "")}>
                                                {isFirstFree && (
                                                    <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 border-t border-border/30 mt-0.5">
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
                                                            ? "bg-primary/10 text-primary"
                                                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                                    )}
                                                >
                                                    <span className="flex-1">{model.label}</span>
                                                    {model.byok && (
                                                        <span className="text-[8px] text-purple-400 bg-purple-500/10 px-1 py-0.5 rounded uppercase tracking-wider font-bold">key</span>
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

                <p className="text-[9px] text-muted-foreground mt-2 text-center font-bold tracking-[0.1em] uppercase opacity-40">
                    <Activity size={10} className="inline mr-2 text-primary" />
                    Architect Engine v2.0 — Self-Correction Active
                </p>
            </div>
        </div>
    );
}
