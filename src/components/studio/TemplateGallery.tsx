"use client";

/**
 * TemplateGallery v2 — Two-pane gallery modeled after Vercel/Linear.
 *
 * Left rail: search + use-case filter + template list with connection badges.
 * Right pane: large preview of the selected template, requirements, files,
 * and the primary "Use template" CTA.
 *
 * Connection badges are color-coded:
 *   green  = provider already connected
 *   amber  = needs a key (wizard will pop on first run)
 *   sky    = public API, no key required
 */

import { useEffect, useMemo, useState } from "react";
import {
    ArrowRight,
    CheckCircle2,
    ExternalLink,
    FileCode,
    Filter,
    Plug,
    Search,
    Sparkles,
    X,
} from "lucide-react";
import { PROJECT_TEMPLATES, type ProjectTemplate, type TemplateUseCase } from "@/lib/studio/templates";
import { useDreyvConnections } from "@/lib/studio/use-dreyv-connections";

interface TemplateGalleryProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectTemplate: (template: ProjectTemplate) => void;
    onBlank: () => void;
}

const USE_CASES: { id: TemplateUseCase | "all"; label: string; description: string }[] = [
    { id: "all", label: "All templates", description: "Every starter in the catalog" },
    { id: "treasury-monitoring", label: "Treasury monitoring", description: "Watch balances, holdings, and on-chain activity" },
    { id: "market-data", label: "Market data", description: "Live prices, oracles, and token analytics" },
    { id: "defi-operations", label: "DeFi operations", description: "Swap, stake, and route on Solana" },
    { id: "team-comms", label: "Team comms", description: "Notify your team via email, Slack, Telegram" },
    { id: "ai-agents", label: "AI agents", description: "Autonomous workflows and MCP" },
];

export function TemplateGallery({ isOpen, onClose, onSelectTemplate, onBlank }: TemplateGalleryProps) {
    const { providers, connections } = useDreyvConnections();

    const [activeUseCase, setActiveUseCase] = useState<TemplateUseCase | "all">("all");
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Group filtered templates
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return PROJECT_TEMPLATES.filter((t) => {
            if (activeUseCase !== "all" && t.useCase !== activeUseCase) return false;
            if (q && !t.name.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [activeUseCase, search]);

    // Auto-select first template when filter changes
    useEffect(() => {
        if (!isOpen) return;
        if (filtered.length === 0) {
            setSelectedId(null);
            return;
        }
        if (!selectedId || !filtered.find((t) => t.id === selectedId)) {
            setSelectedId(filtered[0].id);
        }
    }, [isOpen, filtered, selectedId]);

    // Reset on close
    useEffect(() => {
        if (!isOpen) {
            setSearch("");
            setActiveUseCase("all");
            setSelectedId(null);
        }
    }, [isOpen]);

    const selected = useMemo(
        () => PROJECT_TEMPLATES.find((t) => t.id === selectedId) ?? null,
        [selectedId]
    );

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-6xl h-[85vh] bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-gradient-to-r from-violet-500/5 via-transparent to-transparent">
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-violet-500/10 p-2 ring-1 ring-violet-500/20">
                            <Sparkles className="size-4 text-violet-400" />
                        </div>
                        <div>
                            <h2 className="text-base font-semibold text-white">New mini-app</h2>
                            <p className="text-xs text-zinc-500">Pick a starter, or build from a blank canvas</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-white transition-colors"
                        aria-label="Close"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                {/* Body — two panes */}
                <div className="flex-1 flex min-h-0">
                    {/* ─── Left rail ─────────────────────────── */}
                    <aside className="w-[320px] flex-shrink-0 border-r border-white/10 flex flex-col bg-zinc-950/60">
                        {/* Search */}
                        <div className="p-3 border-b border-white/5">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-600" />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search templates…"
                                    className="w-full bg-zinc-900/60 border border-white/10 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/40"
                                />
                            </div>
                        </div>

                        {/* Use-case filters */}
                        <div className="px-2 py-2 border-b border-white/5">
                            <div className="flex items-center gap-1.5 px-2 mb-1.5">
                                <Filter className="size-3 text-zinc-600" />
                                <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-600">Use case</span>
                            </div>
                            <div className="space-y-0.5">
                                {USE_CASES.map((uc) => {
                                    const active = activeUseCase === uc.id;
                                    return (
                                        <button
                                            key={uc.id}
                                            onClick={() => setActiveUseCase(uc.id)}
                                            className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                                                active
                                                    ? "bg-violet-500/15 text-violet-200"
                                                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                                            }`}
                                        >
                                            {uc.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Template list */}
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {/* Blank project */}
                            <button
                                onClick={onBlank}
                                className="w-full text-left rounded-lg border border-dashed border-white/10 hover:border-violet-500/40 hover:bg-violet-500/5 px-3 py-2.5 transition-colors group"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">📄</span>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-medium text-white">Blank project</div>
                                        <div className="text-[10px] text-zinc-500">Start from scratch</div>
                                    </div>
                                </div>
                            </button>

                            {filtered.length === 0 ? (
                                <div className="px-3 py-8 text-center text-xs text-zinc-600">
                                    No templates match.
                                </div>
                            ) : (
                                filtered.map((t) => {
                                    const active = selectedId === t.id;
                                    return (
                                        <button
                                            key={t.id}
                                            onClick={() => setSelectedId(t.id)}
                                            className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors border ${
                                                active
                                                    ? "border-violet-500/40 bg-violet-500/10"
                                                    : "border-transparent hover:bg-white/5"
                                            }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-base">{t.icon}</span>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-xs font-medium text-white truncate">{t.name}</div>
                                                    <div className="text-[10px] text-zinc-500 truncate">{t.description}</div>
                                                </div>
                                            </div>
                                            {t.requiredProviders.length > 0 && (
                                                <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                                                    {t.requiredProviders.map((pid) => {
                                                        const connected = connections.some((c) => c.provider === pid);
                                                        return (
                                                            <span
                                                                key={pid}
                                                                className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-medium ${
                                                                    connected
                                                                        ? "bg-emerald-500/15 text-emerald-300"
                                                                        : "bg-amber-500/15 text-amber-300"
                                                                }`}
                                                            >
                                                                {connected && <CheckCircle2 className="size-2.5" />}
                                                                {pid}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </button>
                                    );
                                })
                            )}
                        </div>

                        <div className="px-3 py-2 border-t border-white/5 text-[10px] text-zinc-600">
                            {filtered.length} template{filtered.length !== 1 ? "s" : ""} · {connections.length} connection{connections.length !== 1 ? "s" : ""}
                        </div>
                    </aside>

                    {/* ─── Right preview pane ─────────────────── */}
                    <main className="flex-1 overflow-y-auto">
                        {selected ? (
                            <PreviewPane
                                template={selected}
                                providers={providers}
                                connectedIds={connections.map((c) => c.provider)}
                                onUse={() => {
                                    onSelectTemplate(selected);
                                    onClose();
                                }}
                            />
                        ) : (
                            <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
                                Select a template to preview
                            </div>
                        )}
                    </main>
                </div>
            </div>
        </div>
    );
}

function PreviewPane({
    template,
    providers,
    connectedIds,
    onUse,
}: {
    template: ProjectTemplate;
    providers: { id: string; name: string; secretFields: { name: string }[]; docsUrl: string }[];
    connectedIds: string[];
    onUse: () => void;
}) {
    const requirements = template.requiredProviders.map((pid) => {
        const def = providers.find((p) => p.id === pid);
        const connected = connectedIds.includes(pid);
        const isPublic = def ? def.secretFields.length === 0 : false;
        return { pid, def, connected, isPublic };
    });

    const fileCount = Object.keys(template.files).length;
    const lineCount = Object.values(template.files).reduce(
        (sum, content) => sum + content.split("\n").length,
        0
    );

    return (
        <div className="p-8 space-y-6">
            {/* Title row */}
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 min-w-0 flex-1">
                    <div className="text-4xl flex-shrink-0">{template.icon}</div>
                    <div className="min-w-0 flex-1">
                        <h1 className="text-2xl font-bold text-white">{template.name}</h1>
                        <p className="mt-1 text-sm text-zinc-400 leading-relaxed">{template.description}</p>
                        <div className="mt-3 flex items-center gap-3 text-[11px] text-zinc-500">
                            <span className="inline-flex items-center gap-1">
                                <FileCode className="size-3" /> {fileCount} file{fileCount !== 1 ? "s" : ""}
                            </span>
                            <span>·</span>
                            <span>{lineCount} lines</span>
                            <span>·</span>
                            <span className="capitalize">{template.useCase.replace("-", " ")}</span>
                        </div>
                    </div>
                </div>
                <button
                    onClick={onUse}
                    className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors flex-shrink-0"
                >
                    Use template <ArrowRight className="size-4" />
                </button>
            </div>

            {/* Requirements */}
            <section>
                <h2 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-3">
                    Required connections
                </h2>
                {requirements.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 text-sm text-zinc-400">
                        No external connections — this template runs purely on the SDK.
                    </div>
                ) : (
                    <div className="space-y-2">
                        {requirements.map(({ pid, def, connected, isPublic }) => (
                            <div
                                key={pid}
                                className="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-900/40 px-4 py-3"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div
                                        className={`size-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                            connected
                                                ? "bg-emerald-500/15 text-emerald-300"
                                                : isPublic
                                                ? "bg-sky-500/15 text-sky-300"
                                                : "bg-amber-500/15 text-amber-300"
                                        }`}
                                    >
                                        {connected ? <CheckCircle2 className="size-4" /> : <Plug className="size-4" />}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-white">{def?.name ?? pid}</div>
                                        <div className="text-[11px] text-zinc-500">
                                            {connected
                                                ? "Connected — ready to use"
                                                : isPublic
                                                ? "Public API — no key required"
                                                : "Needs a key — wizard will pop on first run"}
                                        </div>
                                    </div>
                                </div>
                                {def?.docsUrl && (
                                    <a
                                        href={def.docsUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[11px] text-zinc-500 hover:text-violet-400 inline-flex items-center gap-1 flex-shrink-0"
                                    >
                                        Docs <ExternalLink className="size-3" />
                                    </a>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Files */}
            <section>
                <h2 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-3">
                    Starter files
                </h2>
                <div className="rounded-xl border border-white/10 bg-zinc-900/40 overflow-hidden">
                    {Object.entries(template.files).map(([name, content], i) => (
                        <div
                            key={name}
                            className={`px-4 py-3 ${i > 0 ? "border-t border-white/5" : ""}`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <FileCode className="size-3.5 text-zinc-500" />
                                    <span className="text-xs font-mono text-zinc-200">{name}</span>
                                </div>
                                <span className="text-[10px] text-zinc-600">
                                    {content.split("\n").length} lines
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
