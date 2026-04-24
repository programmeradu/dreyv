"use client";

import { cn } from "@/lib/utils";
import {
    FilePlus,
    FileEdit,
    Loader2,
    Wrench,
    CheckCircle2,
    AlertTriangle,
    Brain,
} from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";

export type ActivityCard =
    | { id: string; kind: "thinking"; text: string; collapsed?: boolean; done?: boolean }
    | { id: string; kind: "plan"; prompt: string }
    | { id: string; kind: "file_added"; file: string; lines: number }
    | { id: string; kind: "file_modified"; file: string; addedLines: number; removedLines: number }
    | { id: string; kind: "analyzing"; fileCount: number }
    | { id: string; kind: "issues_found"; count: number; preview: string[] }
    | { id: string; kind: "fixing"; attempt: number; max: number; issues: string[] }
    | {
        id: string;
        kind: "done";
        fileCount: number;
        bytes: number;
        elapsedMs: number;
        model: string;
        provider: string;
        tokens: number;
    }
    | { id: string; kind: "error"; error: string };

interface Props {
    card: ActivityCard;
    onOpenFile?: (file: string) => void;
    onToggleThinking?: (id: string) => void;
}

function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function formatMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

export function ArchitectActivityCard({ card, onOpenFile, onToggleThinking }: Props) {
    if (card.kind === "thinking") {
        const isStreaming = !card.done;
        return (
            <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2 text-[12px]">
                <button
                    onClick={() => onToggleThinking?.(card.id)}
                    className="flex w-full items-center gap-2 text-left text-muted-foreground hover:text-foreground transition-colors"
                >
                    <Brain
                        size={12}
                        className={cn(
                            "shrink-0",
                            isStreaming ? "text-primary animate-pulse" : "text-muted-foreground"
                        )}
                    />
                    <span className="font-mono text-[10px] uppercase tracking-wider font-bold">
                        {isStreaming ? "Thinking…" : "Thought process"}
                    </span>
                    <span className="ml-auto text-[9px] text-muted-foreground/60">
                        {card.collapsed ? "show" : "hide"}
                    </span>
                </button>
                {!card.collapsed && card.text && (
                    <div className="mt-2 pl-5 text-[12px] leading-relaxed text-muted-foreground/80 whitespace-pre-wrap font-sans border-l border-border/40 ml-1.5">
                        {card.text}
                        {isStreaming && <span className="inline-block w-1 h-3 ml-0.5 bg-primary animate-pulse align-middle" />}
                    </div>
                )}
            </div>
        );
    }

    if (card.kind === "plan") {
        return (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[12px] flex items-center gap-2">
                <DreyvStar size={12} className="text-primary shrink-0" />
                <span className="text-foreground/80 font-medium truncate">
                    Planning: <span className="text-primary">{card.prompt}</span>
                </span>
            </div>
        );
    }

    if (card.kind === "file_added") {
        return (
            <button
                onClick={() => onOpenFile?.(card.file)}
                className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[12px] flex items-center gap-2 hover:bg-emerald-500/10 transition-colors text-left"
            >
                <FilePlus size={12} className="text-emerald-400 shrink-0" />
                <span className="font-mono text-foreground/90 truncate">{card.file}</span>
                <span className="text-[10px] text-emerald-400/70 ml-auto shrink-0">
                    +{card.lines} lines
                </span>
            </button>
        );
    }

    if (card.kind === "file_modified") {
        return (
            <button
                onClick={() => onOpenFile?.(card.file)}
                className="w-full rounded-lg border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-[12px] flex items-center gap-2 hover:bg-blue-500/10 transition-colors text-left"
            >
                <FileEdit size={12} className="text-blue-400 shrink-0" />
                <span className="font-mono text-foreground/90 truncate">{card.file}</span>
                <span className="text-[10px] text-blue-400/70 ml-auto shrink-0 font-mono">
                    {card.addedLines > 0 && <span className="text-emerald-400">+{card.addedLines}</span>}
                    {card.removedLines > 0 && (
                        <span className="text-red-400 ml-1">-{card.removedLines}</span>
                    )}
                </span>
            </button>
        );
    }

    if (card.kind === "analyzing") {
        return (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-[12px] flex items-center gap-2">
                <Loader2 size={12} className="text-yellow-400 shrink-0 animate-spin" />
                <span className="text-foreground/80">
                    Analyzing {card.fileCount} file{card.fileCount === 1 ? "" : "s"}…
                </span>
            </div>
        );
    }

    if (card.kind === "issues_found") {
        return (
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-[12px]">
                <div className="flex items-center gap-2">
                    <AlertTriangle size={12} className="text-orange-400 shrink-0" />
                    <span className="text-foreground/80">
                        Found {card.count} issue{card.count === 1 ? "" : "s"}
                    </span>
                </div>
                {card.preview.length > 0 && (
                    <ul className="mt-1.5 pl-5 text-[11px] text-muted-foreground/80 space-y-0.5">
                        {card.preview.map((p, i) => (
                            <li key={i} className="truncate">• {p}</li>
                        ))}
                    </ul>
                )}
            </div>
        );
    }

    if (card.kind === "fixing") {
        return (
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-[12px] flex items-center gap-2">
                <Wrench size={12} className="text-orange-400 shrink-0 animate-pulse" />
                <span className="text-foreground/80">
                    Fixing — attempt {card.attempt}/{card.max}
                </span>
                {card.issues[0] && (
                    <span className="text-[10px] text-muted-foreground/70 ml-auto truncate max-w-[40%]">
                        {card.issues[0]}
                    </span>
                )}
            </div>
        );
    }

    if (card.kind === "done") {
        return (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2.5 text-[12px]">
                <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                    <span className="font-bold text-emerald-400 uppercase text-[10px] tracking-wider">
                        Build complete
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pl-5 text-[11px] font-mono text-muted-foreground">
                    <div>
                        <span className="text-foreground/70">{card.fileCount}</span> files
                    </div>
                    <div>
                        <span className="text-foreground/70">{formatBytes(card.bytes)}</span> bundle
                    </div>
                    <div>
                        <span className="text-foreground/70">{formatMs(card.elapsedMs)}</span> elapsed
                    </div>
                    <div>
                        <span className="text-foreground/70">~{card.tokens.toLocaleString()}</span> tokens
                    </div>
                    <div className="col-span-2 truncate">
                        <span className="text-foreground/50">{card.provider}</span>
                        <span className="mx-1 text-border">·</span>
                        <span className="text-foreground/70">{card.model}</span>
                    </div>
                </div>
            </div>
        );
    }

    if (card.kind === "error") {
        return (
            <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-[12px]">
                <div className="flex items-center gap-2">
                    <AlertTriangle size={12} className="text-red-400 shrink-0" />
                    <span className="font-bold text-red-400 uppercase text-[10px] tracking-wider">
                        Failed
                    </span>
                </div>
                <p className="mt-1 pl-5 text-[11px] text-muted-foreground whitespace-pre-wrap">
                    {card.error}
                </p>
            </div>
        );
    }

    return null;
}
