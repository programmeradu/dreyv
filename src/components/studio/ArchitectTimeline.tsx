"use client";

/**
 * ArchitectTimeline — Cursor/Lovable-style activity timeline
 *
 * Renders the agent's step-by-step trajectory as a vertical compact list:
 *   • Narration chips (assistant prose between actions)
 *   • Tool rows ("Edited App.tsx", "Read system-prompt.ts", "Analyzed 3 files")
 *   • Expandable rows with diff preview / issue list
 *   • Plan/done/error states inline
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
    FileEdit,
    FilePlus,
    Eye,
    Loader2,
    Wrench,
    CheckCircle2,
    AlertTriangle,
    Brain,
    Sparkles,
    ChevronRight,
    Activity,
} from "lucide-react";
import type { ActivityCard } from "@/components/studio/ArchitectActivityCard";

export type TimelineItem =
    | { id: string; kind: "narration"; role: "user" | "assistant"; text: string; timestamp: number }
    | { id: string; kind: "activity"; card: ActivityCard; timestamp: number };

interface Props {
    items: TimelineItem[];
    onOpenFile?: (file: string) => void;
    isLive?: boolean;
    currentAction?: string | null;
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ActivityRow({ card, onOpenFile }: { card: ActivityCard; onOpenFile?: (file: string) => void }) {
    const [expanded, setExpanded] = useState(false);

    // Compact one-line representation
    if (card.kind === "thinking") {
        const isStreaming = !card.done;
        return (
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-start gap-2 py-1.5 px-2 rounded hover:bg-muted/30 transition-colors text-left group"
            >
                <Brain
                    size={13}
                    className={cn(
                        "shrink-0 mt-0.5",
                        isStreaming ? "text-primary animate-pulse" : "text-muted-foreground"
                    )}
                />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-[12px]">
                        <span className="text-foreground/70 font-medium">
                            {isStreaming ? "Thinking" : "Thought"}
                        </span>
                        {card.text && (
                            <span className="text-muted-foreground truncate text-[11px]">
                                {card.text.slice(0, 80)}
                                {card.text.length > 80 ? "…" : ""}
                            </span>
                        )}
                    </div>
                    {expanded && card.text && (
                        <div className="mt-2 pl-1 text-[11px] leading-relaxed text-muted-foreground/90 whitespace-pre-wrap border-l-2 border-primary/30 pl-2">
                            {card.text}
                        </div>
                    )}
                </div>
                <ChevronRight
                    size={11}
                    className={cn(
                        "shrink-0 mt-1 text-muted-foreground/50 transition-transform",
                        expanded && "rotate-90"
                    )}
                />
            </button>
        );
    }

    if (card.kind === "plan") {
        return (
            <div className="flex items-center gap-2 py-1.5 px-2 text-[12px]">
                <Sparkles size={13} className="text-primary shrink-0" />
                <span className="text-muted-foreground">Planning</span>
                <span className="text-foreground/80 truncate">{card.prompt}</span>
            </div>
        );
    }

    if (card.kind === "file_added") {
        return (
            <button
                onClick={() => onOpenFile?.(card.file)}
                className="w-full flex items-center gap-2 py-1.5 px-2 rounded hover:bg-emerald-500/10 transition-colors text-left text-[12px] group"
            >
                <FilePlus size={13} className="text-emerald-400 shrink-0" />
                <span className="text-muted-foreground">Created</span>
                <span className="font-mono text-foreground/90 truncate group-hover:text-emerald-300">
                    {card.file}
                </span>
                <span className="ml-auto text-[10px] text-emerald-400/60 font-mono shrink-0">
                    +{card.lines}
                </span>
                <Eye size={10} className="text-muted-foreground/40 group-hover:text-emerald-400 shrink-0" />
            </button>
        );
    }

    if (card.kind === "file_modified") {
        return (
            <button
                onClick={() => onOpenFile?.(card.file)}
                className="w-full flex items-center gap-2 py-1.5 px-2 rounded hover:bg-blue-500/10 transition-colors text-left text-[12px] group"
            >
                <FileEdit size={13} className="text-blue-400 shrink-0" />
                <span className="text-muted-foreground">Edited</span>
                <span className="font-mono text-foreground/90 truncate group-hover:text-blue-300">
                    {card.file}
                </span>
                <span className="ml-auto text-[10px] font-mono shrink-0 flex gap-1">
                    {card.addedLines > 0 && <span className="text-emerald-400">+{card.addedLines}</span>}
                    {card.removedLines > 0 && <span className="text-red-400">-{card.removedLines}</span>}
                </span>
                <Eye size={10} className="text-muted-foreground/40 group-hover:text-blue-400 shrink-0" />
            </button>
        );
    }

    if (card.kind === "analyzing") {
        return (
            <div className="flex items-center gap-2 py-1.5 px-2 text-[12px]">
                <Loader2 size={13} className="text-yellow-400 shrink-0 animate-spin" />
                <span className="text-muted-foreground">Analyzing</span>
                <span className="text-foreground/80">
                    {card.fileCount} file{card.fileCount === 1 ? "" : "s"}
                </span>
            </div>
        );
    }

    if (card.kind === "issues_found") {
        return (
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-start gap-2 py-1.5 px-2 rounded hover:bg-orange-500/10 transition-colors text-left text-[12px] group"
            >
                <AlertTriangle size={13} className="text-orange-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Found</span>
                        <span className="text-foreground/80">
                            {card.count} issue{card.count === 1 ? "" : "s"}
                        </span>
                    </div>
                    {expanded && card.preview.length > 0 && (
                        <ul className="mt-1.5 pl-1 text-[11px] text-muted-foreground/80 space-y-0.5">
                            {card.preview.map((p, i) => (
                                <li key={i} className="truncate">• {p}</li>
                            ))}
                        </ul>
                    )}
                </div>
                <ChevronRight
                    size={11}
                    className={cn(
                        "shrink-0 mt-1 text-muted-foreground/50 transition-transform",
                        expanded && "rotate-90"
                    )}
                />
            </button>
        );
    }

    if (card.kind === "fixing") {
        return (
            <div className="flex items-center gap-2 py-1.5 px-2 text-[12px]">
                <Wrench size={13} className="text-orange-400 shrink-0 animate-pulse" />
                <span className="text-muted-foreground">Fixing</span>
                <span className="text-foreground/80 font-mono text-[11px]">
                    attempt {card.attempt}/{card.max}
                </span>
                {card.issues[0] && (
                    <span className="text-muted-foreground/60 text-[11px] truncate">
                        — {card.issues[0]}
                    </span>
                )}
            </div>
        );
    }

    if (card.kind === "done") {
        return (
            <div className="flex items-start gap-2 py-2 px-2 rounded bg-emerald-500/5 border border-emerald-500/20 text-[12px]">
                <CheckCircle2 size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <div className="font-bold text-emerald-400 text-[11px] uppercase tracking-wider">
                        Build complete
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground font-mono">
                        {card.fileCount} files · {(card.bytes / 1024).toFixed(1)}KB · {(card.elapsedMs / 1000).toFixed(1)}s
                        {" · "}
                        <span className="text-foreground/60">{card.model}</span>
                    </div>
                </div>
            </div>
        );
    }

    if (card.kind === "error") {
        return (
            <div className="flex items-start gap-2 py-2 px-2 rounded bg-red-500/5 border border-red-500/20 text-[12px]">
                <AlertTriangle size={13} className="text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <div className="font-bold text-red-400 text-[11px] uppercase tracking-wider">Failed</div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground whitespace-pre-wrap">
                        {card.error}
                    </p>
                </div>
            </div>
        );
    }

    return null;
}

export function ArchitectTimeline({ items, onOpenFile, isLive, currentAction }: Props) {
    if (items.length === 0 && !isLive) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Activity size={24} className="text-muted-foreground/40 mb-2" />
                <p className="text-[12px] text-muted-foreground">
                    Timeline is empty. Send a prompt to see the agent's trajectory.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Sticky header */}
            <div className="px-3 py-2 border-b border-border/40 flex items-center gap-2 bg-background/80 backdrop-blur sticky top-0 z-10">
                <Activity size={11} className="text-primary" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/70">
                    Activity Timeline
                </span>
                <span className="text-[10px] text-muted-foreground/60 ml-auto font-mono">
                    {items.length} step{items.length === 1 ? "" : "s"}
                </span>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto scrollbar-thin">
                <div className="relative py-2">
                    {/* Vertical rail */}
                    <div className="absolute left-[18px] top-0 bottom-0 w-px bg-border/40" />

                    {items.map((item) => (
                        <div key={item.id} className="relative pl-8 pr-3 py-0.5">
                            {/* Rail dot */}
                            <div
                                className={cn(
                                    "absolute left-[14px] top-3 w-2 h-2 rounded-full border-2 border-background",
                                    item.kind === "narration"
                                        ? "bg-muted-foreground/40"
                                        : item.kind === "activity" && item.card.kind === "done"
                                            ? "bg-emerald-400"
                                            : item.kind === "activity" && item.card.kind === "error"
                                                ? "bg-red-400"
                                                : "bg-primary"
                                )}
                            />

                            {item.kind === "narration" ? (
                                <div className="py-1.5">
                                    {item.role === "user" && (
                                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1 font-bold">
                                            You · {formatTime(item.timestamp)}
                                        </div>
                                    )}
                                    <p
                                        className={cn(
                                            "text-[12px] leading-relaxed whitespace-pre-wrap",
                                            item.role === "user"
                                                ? "text-foreground/90 font-medium"
                                                : "text-foreground/80"
                                        )}
                                    >
                                        {item.text}
                                    </p>
                                </div>
                            ) : (
                                <ActivityRow card={item.card} onOpenFile={onOpenFile} />
                            )}
                        </div>
                    ))}

                    {/* Live action indicator */}
                    {isLive && currentAction && (
                        <div className="relative pl-8 pr-3 py-2">
                            <div className="absolute left-[14px] top-3.5 w-2 h-2 rounded-full bg-primary animate-pulse" />
                            <div className="flex items-center gap-2 text-[12px] text-primary">
                                <Loader2 size={11} className="animate-spin" />
                                <span className="italic">{currentAction}</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
