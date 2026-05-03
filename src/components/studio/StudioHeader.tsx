"use client";

import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Shield,
    MoreHorizontal,
    Rocket,
    Loader2,
    Camera,
    FileDown,
    TestTube2,
    BookOpen,
    FolderOpen,
    Plus,
    Files,
    CheckCircle2,
    Circle,
    AlertTriangle,
} from "lucide-react";
import type { StudioCapabilities } from "@/lib/studio/use-capabilities";

export interface StudioHeaderProps {
    appName: string;
    onAppNameChange: (v: string) => void;

    // Save / dirty state
    isDirty: boolean;
    isSaving: boolean;
    lastSavedAt: number | null;
    onSave: () => void;

    // Counts / status
    fileCount: number;
    onOpenFiles: () => void;

    // Build/test status from last run
    lastTestStatus: "none" | "passed" | "failed" | "running";
    lastTestMode: "real" | "static-lint" | null;
    onRunTest: () => void;
    isTesting: boolean;

    // Wallet
    walletLabel: string;
    onWalletClick?: () => void;

    // Overflow actions
    onNewProject: () => void;
    onOpenProjects: () => void;
    onToggleSDK: () => void;
    onPreview: () => void;
    isPreviewing: boolean;
    onExportPdf: () => void;
    isExporting: boolean;

    // Ship
    onShip: () => void;
    isShipping: boolean;

    caps: StudioCapabilities;

    /** Hide the center status cluster (saved/files/lint) — true on the empty state. */
    isEmpty?: boolean;
}

function formatRelativeTime(ts: number | null): string {
    if (!ts) return "Never saved";
    const diff = Date.now() - ts;
    if (diff < 5_000) return "Saved just now";
    if (diff < 60_000) return `Saved ${Math.floor(diff / 1000)}s ago`;
    if (diff < 3_600_000) return `Saved ${Math.floor(diff / 60_000)}m ago`;
    return `Saved ${Math.floor(diff / 3_600_000)}h ago`;
}

export function StudioHeader(props: StudioHeaderProps) {
    const {
        appName, onAppNameChange,
        isDirty, isSaving, lastSavedAt, onSave,
        fileCount, onOpenFiles,
        lastTestStatus, lastTestMode, onRunTest, isTesting,
        walletLabel, onWalletClick,
        onNewProject, onOpenProjects, onToggleSDK,
        onPreview, isPreviewing, onExportPdf, isExporting,
        onShip, isShipping,
        caps,
        isEmpty,
    } = props;

    const [overflowOpen, setOverflowOpen] = useState(false);
    const [, force] = useState(0);
    const overflowRef = useRef<HTMLDivElement>(null);

    // Tick once a minute so "Saved Xs ago" stays fresh
    useEffect(() => {
        const id = setInterval(() => force((n) => n + 1), 15_000);
        return () => clearInterval(id);
    }, []);

    // Close overflow on outside click
    useEffect(() => {
        if (!overflowOpen) return;
        const onDoc = (e: MouseEvent) => {
            if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
                setOverflowOpen(false);
            }
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [overflowOpen]);

    // ─── Status segments ─────────────────────────────────────────
    const savedLabel = isSaving
        ? "Saving…"
        : isDirty
            ? "Unsaved changes"
            : formatRelativeTime(lastSavedAt);

    const savedDot = isSaving
        ? "bg-amber-400 animate-pulse"
        : isDirty
            ? "bg-amber-500"
            : lastSavedAt
                ? "bg-emerald-500"
                : "bg-slate-300";

    const buildIcon =
        lastTestStatus === "running" ? <Loader2 size={11} className="animate-spin" /> :
        lastTestStatus === "passed" ? <CheckCircle2 size={11} className="text-emerald-600" /> :
        lastTestStatus === "failed" ? <AlertTriangle size={11} className="text-red-500" /> :
        <Circle size={11} className="text-slate-400" />;

    const buildLabel =
        lastTestStatus === "running" ? "Testing…" :
        lastTestStatus === "passed" ? (lastTestMode === "real" ? "Smoke test ✓" : "Lint ✓") :
        lastTestStatus === "failed" ? (lastTestMode === "real" ? "Smoke test ✗" : "Lint ✗") :
        caps.browserRendering ? "Run smoke test" : "Run lint check";

    return (
        <header className="h-12 border-b border-slate-200/70 bg-white/90 backdrop-blur flex items-center justify-between px-5 shrink-0 relative z-40">
            {/* ── Left: breadcrumb + editable app name ─────────────── */}
            <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center gap-2 pr-3 border-r border-slate-200/60">
                    <a
                        href="/app"
                        className="flex items-center gap-1.5 group"
                        title="dreyv home"
                    >
                        <div className="w-1.5 h-1.5 rounded-full bg-violet-600 group-hover:bg-violet-700 transition-colors" />
                        <span
                            className="text-[12px] font-semibold tracking-tight text-slate-900 group-hover:text-violet-700 transition-colors"
                            style={{ fontFamily: "Manrope, ui-sans-serif, system-ui" }}
                        >
                            dreyv
                        </span>
                    </a>
                    <span className="text-slate-300 text-xs">/</span>
                    <a
                        href="/app/studio"
                        className="text-[11px] font-medium text-slate-500 hover:text-slate-900 transition-colors"
                    >
                        Studio
                    </a>
                </div>
                {!isEmpty && (
                    <Input
                        value={appName}
                        onChange={(e) => onAppNameChange(e.target.value)}
                        className="h-7 w-48 text-[12px] font-medium text-slate-700 bg-transparent border-transparent hover:border-slate-200 focus:border-violet-300 focus:ring-0 px-2 rounded transition-colors"
                        placeholder="Untitled mini-app"
                    />
                )}
            </div>

            {/* ── Center: live status cluster (hidden on empty state) ── */}
            <div className={`${isEmpty ? "hidden" : "hidden md:flex"} items-center gap-1 text-[11px] text-slate-500 font-medium`}>
                <span
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-50 transition-colors"
                    title={lastSavedAt ? new Date(lastSavedAt).toLocaleString() : "No save yet"}
                >
                    <span className={`w-1.5 h-1.5 rounded-full ${savedDot}`} />
                    {savedLabel}
                </span>
                <span className="text-slate-300">·</span>
                <span
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-slate-500"
                    title={`${fileCount} file${fileCount === 1 ? "" : "s"} in this project`}
                >
                    <Files size={11} />
                    {fileCount} {fileCount === 1 ? "file" : "files"}
                </span>
                <span className="text-slate-300">·</span>
                <button
                    onClick={onRunTest}
                    disabled={isTesting}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-50 hover:text-violet-700 transition-colors disabled:opacity-60"
                    title={
                        caps.browserRendering
                            ? "Real headless-browser smoke test"
                            : "Static lint only — Browser Rendering not configured"
                    }
                >
                    {buildIcon}
                    {buildLabel}
                </button>
            </div>

            {/* ── Right: wallet + overflow + save + ship ───────────── */}
            <div className="flex items-center gap-2">
                {!isEmpty && (
                    <>
                        <div
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-medium text-slate-600 bg-slate-50 border border-slate-200/80"
                            title="Connected signer"
                        >
                            <Shield size={11} className="opacity-70" />
                            <span>{walletLabel}</span>
                        </div>

                        <div className="h-4 w-px bg-slate-200 mx-0.5" />
                    </>
                )}

                {/* Overflow menu */}
                <div className="relative" ref={overflowRef}>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setOverflowOpen((v) => !v)}
                        className="h-7 w-7 p-0 text-slate-500 hover:text-violet-700 hover:bg-violet-50 rounded-md"
                        title="More actions"
                    >
                        <MoreHorizontal size={15} />
                    </Button>
                    {overflowOpen && (
                        <div className="absolute right-0 top-full mt-1.5 w-56 rounded-md border border-slate-200 bg-white shadow-lg py-1 z-50">
                            <OverflowItem icon={<Plus size={13} />} label="New project" onClick={() => { setOverflowOpen(false); onNewProject(); }} />
                            <OverflowItem icon={<FolderOpen size={13} />} label="Open project…" onClick={() => { setOverflowOpen(false); onOpenProjects(); }} />
                            <OverflowItem icon={<BookOpen size={13} />} label="SDK reference" onClick={() => { setOverflowOpen(false); onToggleSDK(); }} />
                            <div className="my-1 h-px bg-slate-100" />
                            <OverflowItem
                                icon={isPreviewing ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
                                label="Capture preview"
                                disabled={!caps.browserRendering || isPreviewing}
                                hint={!caps.browserRendering ? "Needs Browser Rendering" : undefined}
                                onClick={() => { setOverflowOpen(false); onPreview(); }}
                            />
                            <OverflowItem
                                icon={isExporting ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
                                label="Export PDF"
                                disabled={!caps.browserRendering || isExporting}
                                hint={!caps.browserRendering ? "Needs Browser Rendering" : undefined}
                                onClick={() => { setOverflowOpen(false); onExportPdf(); }}
                            />
                            <OverflowItem
                                icon={isTesting ? <Loader2 size={13} className="animate-spin" /> : <TestTube2 size={13} />}
                                label={caps.browserRendering ? "Run smoke test" : "Run lint check"}
                                onClick={() => { setOverflowOpen(false); onRunTest(); }}
                                disabled={isTesting}
                            />
                        </div>
                    )}
                </div>

                {!isEmpty && (
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onSave}
                            disabled={isSaving || !caps.save}
                            className="h-7 px-2.5 text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md disabled:opacity-50"
                            title={!caps.save ? "Save unavailable — database not configured" : "Save to library"}
                        >
                            {isSaving ? "Saving…" : isDirty ? "Save" : "Saved"}
                        </Button>

                        <Button
                            variant="default"
                            size="sm"
                            onClick={onShip}
                            disabled={isShipping || !caps.ship}
                            className="h-7 px-3 text-[10px] font-bold uppercase tracking-[0.18em] rounded-md bg-violet-600 hover:bg-violet-700 text-white shadow-sm disabled:opacity-50"
                            title={!caps.ship ? "Ship unavailable — database not configured" : "Ship to dreyv Library"}
                        >
                            {isShipping ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Rocket size={12} className="mr-1.5" />}
                            {isShipping ? "Shipping…" : "Ship"}
                        </Button>
                    </>
                )}
            </div>
        </header>
    );
}

function OverflowItem({
    icon, label, onClick, disabled, hint,
}: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    hint?: string;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-400 disabled:cursor-not-allowed text-left"
            title={hint}
        >
            <span className="w-4 flex items-center justify-center text-slate-500">{icon}</span>
            <span className="flex-1">{label}</span>
            {hint && <span className="text-[9px] uppercase tracking-wider text-slate-400">{hint}</span>}
        </button>
    );
}
