"use client";

import React, { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { getProjects } from "@/actions/studio-actions";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Loader2,
    FolderOpen,
    FileCode,
    Clock,
    Plus,
    Trash2,
    XIcon,
    ArrowUpRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "@/lib/toast-notifications";
import { cn } from "@/lib/utils";

interface ProjectBrowserProps {
    userId: string;
    isOpen: boolean;
    onClose: () => void;
    onLoadProject: (project: any) => void;
    onNewProject?: () => void;
}

export function ProjectBrowser({
    userId,
    isOpen,
    onClose,
    onLoadProject,
    onNewProject,
}: ProjectBrowserProps) {
    const [projects, setProjects] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState("");

    useEffect(() => {
        if (isOpen) loadProjects();
    }, [isOpen]);

    async function loadProjects() {
        setLoading(true);
        try {
            const dbProjects = await getProjects(userId);
            const sorted = [...dbProjects].sort((a: any, b: any) => {
                const aTime = typeof a.updatedAt === "string" ? new Date(a.updatedAt).getTime() : (a.updatedAt?.getTime?.() || 0);
                const bTime = typeof b.updatedAt === "string" ? new Date(b.updatedAt).getTime() : (b.updatedAt?.getTime?.() || 0);
                return bTime - aTime;
            });
            setProjects(sorted);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(e: React.MouseEvent | React.KeyboardEvent, projectId: string, projectName: string) {
        e.stopPropagation();
        try {
            setProjects((prev) => prev.filter((p) => p.id !== projectId));
            toast.success(`Deleted "${projectName}"`);
        } catch {
            toast.error("Failed to delete project.");
        }
    }

    const filtered = query.trim()
        ? projects.filter((p) =>
              [p.name, p.description].filter(Boolean).join(" ").toLowerCase().includes(query.toLowerCase())
          )
        : projects;

    return (
        <DialogPrimitive.Root open={isOpen} onOpenChange={(v) => { if (!v) onClose(); }}>
            <AnimatePresence>
                {isOpen && (
                    <DialogPrimitive.Portal forceMount>
                        <DialogPrimitive.Overlay asChild>
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="fixed inset-0 z-50 bg-slate-950/40"
                            />
                        </DialogPrimitive.Overlay>
                        <DialogPrimitive.Content asChild>
                            <motion.div
                                data-theme="light"
                                initial={{ opacity: 0, scale: 0.97, y: 12 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                                transition={{ type: "spring", damping: 26, stiffness: 360 }}
                                style={{ colorScheme: "light" }}
                                className={cn(
                                    "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md",
                                    "-translate-x-1/2 -translate-y-1/2 outline-none",
                                    "rounded-2xl border border-violet-100 bg-white text-slate-900",
                                    "overflow-hidden font-[family-name:Manrope,system-ui,sans-serif]"
                                )}
                            >
                                {/* Ambient violet glows — flat, no shadows */}
                                <div className="pointer-events-none absolute -top-20 -right-16 h-44 w-44 rounded-full bg-violet-300/40 blur-3xl" />
                                <div className="pointer-events-none absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-violet-400/30 blur-3xl" />

                                {/* Header */}
                                <div className="relative flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-violet-100">
                                    <div className="flex flex-col gap-0.5 min-w-0">
                                        <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                                            dreyv · studio
                                        </span>
                                        <DialogPrimitive.Title className="text-[16px] font-semibold tracking-tight text-slate-900">
                                            Your projects
                                        </DialogPrimitive.Title>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        {onNewProject && (
                                            <button
                                                onClick={() => { onNewProject(); onClose(); }}
                                                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-violet-600 text-white text-[11px] font-semibold hover:bg-violet-700 transition-colors"
                                            >
                                                <Plus size={12} />
                                                New
                                            </button>
                                        )}
                                        <DialogPrimitive.Close
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-violet-100 text-slate-500 hover:text-violet-700 hover:bg-violet-50 transition-colors"
                                            aria-label="Close"
                                        >
                                            <XIcon className="h-3.5 w-3.5" />
                                        </DialogPrimitive.Close>
                                    </div>
                                </div>

                                {/* Search */}
                                <div className="relative px-5 pt-3 pb-2">
                                    <div className="flex items-center gap-2 h-8 px-3 rounded-lg border border-violet-100 bg-white focus-within:border-violet-300 transition-colors">
                                        <FolderOpen size={12} className="text-violet-500 shrink-0" />
                                        <input
                                            value={query}
                                            onChange={(e) => setQuery(e.target.value)}
                                            placeholder="Search projects…"
                                            className="flex-1 bg-transparent text-[12px] text-slate-800 placeholder:text-slate-400 outline-none"
                                        />
                                        <span className="text-[10px] text-slate-400 tabular-nums">
                                            {filtered.length}/{projects.length}
                                        </span>
                                    </div>
                                </div>
                                {/* Body */}
                                <div className="relative px-7 pb-7">
                                    {loading ? (
                                        <div className="flex items-center justify-center h-64 text-slate-400">
                                            <Loader2 className="animate-spin mr-2 h-4 w-4" />
                                            <span className="text-[13px]">Loading projects…</span>
                                        </div>
                                    ) : filtered.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
                                            <div className="h-12 w-12 rounded-2xl border border-violet-100 bg-white flex items-center justify-center text-violet-400">
                                                <FileCode size={20} />
                                            </div>
                                            <div className="text-center">
                                                <p className="text-[13px] font-medium text-slate-600">
                                                    {projects.length === 0 ? "No saved projects yet." : "No matches."}
                                                </p>
                                                <p className="text-[12px] text-slate-400 mt-0.5">
                                                    {projects.length === 0 ? "Build something and hit save." : "Try a different search."}
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <ScrollArea className="h-[420px] pr-2">
                                            <ul className="flex flex-col gap-2">
                                                {filtered.map((project) => {
                                                    const fileCount = project.code?.files
                                                        ? Object.keys(project.code.files).length
                                                        : 0;
                                                    return (
                                                        <li key={project.id}>
                                                            <button
                                                                onClick={() => { onLoadProject(project); onClose(); }}
                                                                className={cn(
                                                                    "group w-full flex items-center justify-between gap-4 p-4",
                                                                    "rounded-2xl border border-violet-100 bg-white",
                                                                    "hover:border-violet-300 hover:bg-violet-50/40 transition-colors text-left"
                                                                )}
                                                            >
                                                                <div className="flex items-center gap-3.5 min-w-0">
                                                                    <div className="h-10 w-10 rounded-xl border border-violet-100 bg-violet-50 flex items-center justify-center text-violet-600 shrink-0">
                                                                        <FileCode size={17} />
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <h3 className="text-[14px] font-semibold text-slate-900 truncate">
                                                                            {project.name}
                                                                        </h3>
                                                                        <p className="text-[12px] text-slate-500 line-clamp-1">
                                                                            {project.description || "No description"}
                                                                            {fileCount > 0 && (
                                                                                <span className="text-slate-400">
                                                                                    {" · "}{fileCount} file{fileCount === 1 ? "" : "s"}
                                                                                </span>
                                                                            )}
                                                                        </p>
                                                                    </div>
                                                                </div>

                                                                <div className="flex items-center gap-3 shrink-0">
                                                                    <div className="hidden sm:flex flex-col items-end gap-1">
                                                                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 tabular-nums">
                                                                            <Clock size={11} className="text-slate-400" />
                                                                            {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
                                                                        </span>
                                                                        {project.isPublished && (
                                                                            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">
                                                                                Shipped
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div
                                                                        role="button"
                                                                        tabIndex={0}
                                                                        onClick={(e) => handleDelete(e, project.id, project.name)}
                                                                        onKeyDown={(e) => { if (e.key === "Enter") handleDelete(e, project.id, project.name); }}
                                                                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                                                                        title="Delete project"
                                                                    >
                                                                        <Trash2 size={14} />
                                                                    </div>
                                                                    <ArrowUpRight
                                                                        size={15}
                                                                        className="text-slate-300 group-hover:text-violet-600 transition-colors"
                                                                    />
                                                                </div>
                                                            </button>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        </ScrollArea>
                                    )}
                                </div>
                            </motion.div>
                        </DialogPrimitive.Content>
                    </DialogPrimitive.Portal>
                )}
            </AnimatePresence>
        </DialogPrimitive.Root>
    );
}
