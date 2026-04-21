"use client";

/**
 * TemplateGallery v3 — Light, Stitch-inspired premium gallery.
 *
 * Two-pane layout (filter rail + preview) on a warm white shell with
 * violet accents and Manrope display headings to match EmptyState and
 * the rest of the marketing-aligned Studio chrome.
 *
 * Connection badges:
 *   emerald = provider already connected
 *   sky     = public API, no key required
 *   amber   = key needed (Wizard pops on first run)
 */

import { useEffect, useMemo, useState } from "react";
import {
    ArrowRight,
    CheckCircle2,
    ExternalLink,
    FileCode,
    Plug,
    Search,
    X,
} from "lucide-react";
import { PROJECT_TEMPLATES, type ProjectTemplate, type TemplateUseCase } from "@/lib/studio/templates";
import { useDreyvConnections } from "@/lib/studio/use-dreyv-connections";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { TemplateLogo } from "@/components/studio/TemplateLogo";

interface TemplateGalleryProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectTemplate: (template: ProjectTemplate) => void;
    onBlank: () => void;
}

const USE_CASES: { id: TemplateUseCase | "all"; label: string }[] = [
    { id: "all", label: "All" },
    { id: "treasury-monitoring", label: "Treasury" },
    { id: "market-data", label: "Market data" },
    { id: "defi-operations", label: "DeFi" },
    { id: "team-comms", label: "Team comms" },
    { id: "ai-agents", label: "AI agents" },
];

const MANROPE = { fontFamily: "Manrope, ui-sans-serif, system-ui, sans-serif" };

export function TemplateGallery({ isOpen, onClose, onSelectTemplate, onBlank }: TemplateGalleryProps) {
    const { providers, connections } = useDreyvConnections();

    const [activeUseCase, setActiveUseCase] = useState<TemplateUseCase | "all">("all");
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return PROJECT_TEMPLATES.filter((t) => {
            if (activeUseCase !== "all" && t.useCase !== activeUseCase) return false;
            if (q && !t.name.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [activeUseCase, search]);

    // Group by use-case for the right pane
    const grouped = useMemo(() => {
        const map = new Map<TemplateUseCase, ProjectTemplate[]>();
        for (const t of filtered) {
            const arr = map.get(t.useCase) ?? [];
            arr.push(t);
            map.set(t.useCase, arr);
        }
        return Array.from(map.entries());
    }, [filtered]);

    useEffect(() => {
        if (!isOpen) return;
        if (!selectedId || !filtered.find((t) => t.id === selectedId)) {
            setSelectedId(filtered[0]?.id ?? null);
        }
    }, [isOpen, filtered, selectedId]);

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
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 sm:p-6"
            onClick={onClose}
        >
            <div
                className="w-full max-w-6xl h-[88vh] max-h-[820px] bg-white rounded-2xl shadow-[0_30px_80px_-20px_rgba(76,29,149,0.35)] ring-1 ring-slate-200/80 overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* ─── Header ─────────────────────────────────── */}
                <div className="flex items-center justify-between px-5 sm:px-7 py-4 border-b border-slate-200/70 bg-gradient-to-r from-violet-50/80 via-white to-white">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="rounded-lg bg-violet-100 p-2 ring-1 ring-violet-200/80 text-violet-600">
                            <DreyvStar size={16} />
                        </div>
                        <div className="min-w-0">
                            <h2
                                className="text-[15px] font-semibold text-slate-900 truncate"
                                style={MANROPE}
                            >
                                Start a new mini-app
                            </h2>
                            <p className="text-[11px] text-slate-500">
                                Pick a starter or begin from a blank canvas
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                        aria-label="Close"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                {/* ─── Body ───────────────────────────────────── */}
                <div className="flex-1 flex flex-col md:flex-row min-h-0">
                    {/* Left rail */}
                    <aside className="w-full md:w-[260px] md:flex-shrink-0 border-b md:border-b-0 md:border-r border-slate-200/70 bg-slate-50/50 flex flex-col">
                        <div className="p-3">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search templates"
                                    className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100 transition"
                                />
                            </div>
                        </div>

                        <div className="px-3 pb-2 overflow-x-auto md:overflow-visible">
                            <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 mb-2 px-1 hidden md:block">
                                Use case
                            </div>
                            <div className="flex md:flex-col gap-1 md:gap-0.5">
                                {USE_CASES.map((uc) => {
                                    const active = activeUseCase === uc.id;
                                    return (
                                        <button
                                            key={uc.id}
                                            onClick={() => setActiveUseCase(uc.id)}
                                            className={`whitespace-nowrap text-left px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                                                active
                                                    ? "bg-violet-100 text-violet-700"
                                                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                                            }`}
                                        >
                                            {uc.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="px-3 pt-2 pb-3 mt-auto border-t border-slate-200/70 hidden md:block">
                            <button
                                onClick={onBlank}
                                className="w-full text-left rounded-lg border border-dashed border-slate-300 hover:border-violet-300 hover:bg-violet-50 px-3 py-2.5 transition-colors group"
                            >
                                <div className="flex items-center gap-2">
                                    <div className="size-7 rounded-md bg-white ring-1 ring-slate-200 flex items-center justify-center text-slate-500 group-hover:text-violet-600 group-hover:ring-violet-200">
                                        <FileCode className="size-3.5" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[12px] font-semibold text-slate-900 group-hover:text-violet-700">
                                            Blank project
                                        </div>
                                        <div className="text-[10px] text-slate-500">Start from scratch</div>
                                    </div>
                                </div>
                            </button>
                        </div>
                    </aside>

                    {/* Right pane — grid + preview */}
                    <main className="flex-1 min-h-0 overflow-y-auto">
                        <div className="p-5 sm:p-6">
                            {filtered.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-slate-200 p-12 text-center text-sm text-slate-500">
                                    No templates match your filters.
                                </div>
                            ) : (
                                <div className="space-y-7">
                                    {grouped.map(([useCase, items]) => (
                                        <section key={useCase}>
                                            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 mb-3">
                                                {USE_CASES.find((u) => u.id === useCase)?.label ?? useCase}
                                            </h3>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                {items.map((t) => (
                                                    <TemplateCard
                                                        key={t.id}
                                                        template={t}
                                                        active={selectedId === t.id}
                                                        connectedIds={connections.map((c) => c.provider)}
                                                        providers={providers}
                                                        onSelect={() => setSelectedId(t.id)}
                                                        onUse={() => {
                                                            onSelectTemplate(t);
                                                            onClose();
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        </section>
                                    ))}
                                </div>
                            )}
                        </div>

                        {selected && (
                            <PreviewFooter
                                template={selected}
                                providers={providers}
                                connectedIds={connections.map((c) => c.provider)}
                                onUse={() => {
                                    onSelectTemplate(selected);
                                    onClose();
                                }}
                            />
                        )}
                    </main>
                </div>
            </div>
        </div>
    );
}

/* ─── Card ─────────────────────────────────────────── */
function TemplateCard({
    template,
    active,
    connectedIds,
    providers,
    onSelect,
    onUse,
}: {
    template: ProjectTemplate;
    active: boolean;
    connectedIds: string[];
    providers: { id: string; secretFields: { name: string }[] }[];
    onSelect: () => void;
    onUse: () => void;
}) {
    const fileCount = Object.keys(template.files).length;
    return (
        <button
            onClick={onSelect}
            onDoubleClick={onUse}
            className={`group relative text-left rounded-xl border bg-white p-4 transition-all ${
                active
                    ? "border-violet-300 ring-2 ring-violet-100 shadow-[0_8px_24px_-12px_rgba(124,58,237,0.35)]"
                    : "border-slate-200/80 hover:border-violet-200 hover:shadow-sm"
            }`}
        >
            <div className="flex items-start gap-3">
                <TemplateLogo
                    templateId={template.id}
                    providerId={template.requiredProviders[0]}
                    name={template.name}
                    size={40}
                />
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                        <h4
                            className="text-[13px] font-semibold text-slate-900 truncate"
                            style={MANROPE}
                        >
                            {template.name}
                        </h4>
                        <span className="text-[10px] text-slate-400 flex-shrink-0 mt-0.5">
                            {fileCount} file{fileCount !== 1 ? "s" : ""}
                        </span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-slate-500 line-clamp-2 leading-relaxed">
                        {template.description}
                    </p>

                    {template.requiredProviders.length > 0 && (
                        <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                            {template.requiredProviders.map((pid) => {
                                const def = providers.find((p) => p.id === pid);
                                const connected = connectedIds.includes(pid);
                                const isPublic = def ? def.secretFields.length === 0 : false;
                                const cls = connected
                                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                    : isPublic
                                    ? "bg-sky-50 text-sky-700 ring-sky-200"
                                    : "bg-amber-50 text-amber-700 ring-amber-200";
                                return (
                                    <span
                                        key={pid}
                                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ${cls}`}
                                    >
                                        {connected && <CheckCircle2 className="size-2.5" />}
                                        {pid}
                                    </span>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </button>
    );
}

/* ─── Sticky preview footer ───────────────────────── */
function PreviewFooter({
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

    return (
        <div className="sticky bottom-0 border-t border-slate-200/80 bg-white/95 backdrop-blur px-5 sm:px-6 py-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    <TemplateLogo
                        templateId={template.id}
                        providerId={template.requiredProviders[0]}
                        name={template.name}
                        size={36}
                    />
                    <div className="min-w-0">
                        <div
                            className="text-[13px] font-semibold text-slate-900 truncate"
                            style={MANROPE}
                        >
                            {template.name}
                        </div>
                        {requirements.length > 0 ? (
                            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                {requirements.map(({ pid, def, connected, isPublic }) => (
                                    <span
                                        key={pid}
                                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                                            connected
                                                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                                : isPublic
                                                ? "bg-sky-50 text-sky-700 ring-sky-200"
                                                : "bg-amber-50 text-amber-700 ring-amber-200"
                                        }`}
                                    >
                                        {connected ? (
                                            <CheckCircle2 className="size-2.5" />
                                        ) : (
                                            <Plug className="size-2.5" />
                                        )}
                                        {def?.name ?? pid}
                                        {def?.docsUrl && !connected && !isPublic && (
                                            <a
                                                href={def.docsUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="ml-0.5 hover:text-violet-600"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <ExternalLink className="size-2.5" />
                                            </a>
                                        )}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <div className="text-[11px] text-slate-500 mt-0.5">
                                No external connections needed
                            </div>
                        )}
                    </div>
                </div>
                <button
                    onClick={onUse}
                    className="inline-flex items-center gap-2 rounded-full bg-violet-600 hover:bg-violet-700 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(124,58,237,0.6)] transition-colors flex-shrink-0"
                >
                    Use this template <ArrowRight className="size-3.5" />
                </button>
            </div>
        </div>
    );
}
