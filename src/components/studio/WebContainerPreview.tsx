"use client";

/**
 * WebContainerPreview — full-fidelity preview engine for Dreyv Studio.
 *
 * Loads /app/studio/wc-host (cross-origin isolated) inside an iframe, ships
 * the user's mini-app files via postMessage, and renders the resulting Vite
 * server URL in a second iframe.
 *
 * The host iframe is hidden — it's purely a Node/Vite runtime carrier.
 * The visible iframe is the live mini-app.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle, RotateCw, ExternalLink } from "lucide-react";


interface StudioFile {
    name: string;
    content: string;
    language: string;
}

interface WebContainerPreviewProps {
    files: Record<string, StudioFile>;
    onLogsChange?: (logs: string[]) => void;
}

type HostMessage =
    | { source: "dreyv-wc-host"; type: "wc:status"; phase: string; message?: string }
    | { source: "dreyv-wc-host"; type: "wc:server-ready"; url: string }
    | { source: "dreyv-wc-host"; type: "wc:log"; stream: "install" | "dev" | "system"; chunk: string }
    | { source: "dreyv-wc-host"; type: "wc:error"; message: string };

function flatten(files: Record<string, StudioFile>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of Object.values(files)) {
        out[f.name.replace(/^\/+/, "")] = f.content;
    }
    return out;
}

export function WebContainerPreview({ files, onLogsChange }: WebContainerPreviewProps) {
    const hostIframeRef = useRef<HTMLIFrameElement | null>(null);
    const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
    const hostReadyRef = useRef(false);
    const bootedRef = useRef(false);
    const filesRef = useRef(files);
    const logsRef = useRef<string[]>([]);

    const [phase, setPhase] = useState("Loading host…");
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [hostSession, setHostSession] = useState(0);

    filesRef.current = files;

    const pushLog = (line: string) => {
        logsRef.current = [...logsRef.current.slice(-1000), line];
        onLogsChange?.(logsRef.current);
    };

    // Bridge: receive messages from the host iframe.
    useEffect(() => {
        if (!window.isSecureContext) {
            setError("Full preview needs HTTPS or localhost.");
            return;
        }
        if (!window.crossOriginIsolated) {
            const inIframe = window.top !== window.self;
            setError(
                inIframe
                    ? "Full preview can't run inside an embedded preview. Open Studio in a new tab to enable cross-origin isolation."
                    : "Full preview needs cross-origin isolation. Hard-reload the page (Cmd/Ctrl+Shift+R) so the new headers take effect.",
            );
            return;
        }


        function onMessage(ev: MessageEvent<HostMessage>) {
            if (ev.source !== hostIframeRef.current?.contentWindow) return;
            const data = ev.data;
            if (!data || data.source !== "dreyv-wc-host") return;
            switch (data.type) {
                case "wc:status":
                    if (data.phase === "ready" && !bootedRef.current) {
                        hostReadyRef.current = true;
                        setPhase("Booting WebContainer…");
                        hostIframeRef.current?.contentWindow?.postMessage(
                            { type: "wc:boot", files: flatten(filesRef.current) },
                            "*",
                        );
                    } else if (data.phase === "booting" || data.phase === "mounting" || data.phase === "installing" || data.phase === "starting" || data.phase === "running") {
                        bootedRef.current = true;
                        if (data.message) {
                            setPhase(data.message);
                            pushLog(`[wc] ${data.message}`);
                        }
                    } else if (data.phase === "restart") {
                        bootedRef.current = false;
                        hostReadyRef.current = false;
                        if (data.message) {
                            setPhase(data.message);
                            pushLog(`[wc] ${data.message}`);
                        }
                    } else if (data.message) {
                        setPhase(data.message);
                        pushLog(`[wc] ${data.message}`);
                    }
                    break;
                case "wc:server-ready":
                    setPreviewUrl(data.url);
                    setPhase("");
                    setError(null);
                    pushLog(`[wc] dev server ready at ${data.url}`);
                    break;
                case "wc:log": {
                    // Strip ANSI color codes from npm/vite output for the panel.
                    const clean = data.chunk.replace(/\u001b\[[0-9;]*m/g, "").trimEnd();
                    if (!clean) break;
                    for (const line of clean.split("\n")) {
                        if (line.trim()) pushLog(`[${data.stream}] ${line}`);
                    }
                    break;
                }
                case "wc:error":
                    setError(data.message);
                    setPhase("");
                    pushLog(`[error] ${data.message}`);
                    break;
            }
        }
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [hostSession, onLogsChange]);

    // Surface a clear error if the host iframe never checks in (instead of
    // spinning forever). No fallback — user explicitly opted into Full mode.
    useEffect(() => {
        if (previewUrl || error) return;
        const t = window.setTimeout(() => {
            if (!hostReadyRef.current && !previewUrl && !error) {
                setError(
                    "Full preview host did not respond within 15s. Hard-reload (Cmd/Ctrl+Shift+R) so cross-origin isolation headers apply, then click Restart.",
                );
            }
        }, 15_000);
        return () => window.clearTimeout(t);
    }, [previewUrl, error, hostSession]);

    // Hot file sync: after boot, push any file changes to the live container.
    useEffect(() => {
        if (!previewUrl) return; // wait until first dev server is up
        const t = window.setTimeout(() => {
            hostIframeRef.current?.contentWindow?.postMessage(
                { type: "wc:write", files: flatten(files) },
                "*",
            );
        }, 250);
        return () => window.clearTimeout(t);
    }, [files, previewUrl]);

    const handleRestart = () => {
        bootedRef.current = false;
        hostReadyRef.current = false;
        setPreviewUrl(null);
        setError(null);
        setPhase("Restarting host…");
        // WebContainer is a browser singleton. Recreate the hidden iframe so a
        // failed/stale instance is released before the next boot request.
        setHostSession((session) => session + 1);
    };

    return (
        <div className="relative h-full w-full bg-white">
            {/* Hidden host iframe runs Node/Vite in browser via WebContainers */}
            <iframe
                key={hostSession}
                ref={hostIframeRef}
                src={`/app/studio/wc-host?session=${hostSession}`}
                title="Dreyv WebContainer Host"
                style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                allow="cross-origin-isolated"
            />

            {/* Boot/loading overlay */}
            {!previewUrl && !error && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white">
                    <Loader2 className="mb-4 h-8 w-8 animate-spin text-violet-600" />
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                        {phase || "Booting…"}
                    </p>
                    <p className="mt-2 font-mono text-[10px] text-slate-400">
                        Node.js + Vite · running in your browser
                    </p>
                </div>
            )}

            {/* Error banner — keeps last preview visible if there is one */}
            {error && (
                <div className="absolute left-2 right-2 top-2 z-20 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 shadow-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <div className="min-w-0 flex-1">
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-600">
                            WebContainer error
                        </div>
                        <p className="line-clamp-3 break-words text-xs leading-relaxed text-slate-700">
                            {error}
                        </p>
                    </div>
                    {typeof window !== "undefined" && window.top !== window.self && !window.crossOriginIsolated ? (
                        <a
                            href="/app/studio"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-600 hover:bg-red-50"
                        >
                            <ExternalLink className="h-3 w-3" /> Open in new tab
                        </a>
                    ) : (
                        <button
                            onClick={handleRestart}
                            className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-600 hover:bg-red-50"
                        >
                            <RotateCw className="h-3 w-3" /> Restart
                        </button>
                    )}
                </div>
            )}


            {/* Live preview iframe — points at the in-browser Vite server */}
            {previewUrl && (
                <iframe
                    ref={previewIframeRef}
                    src={previewUrl}
                    title="Dreyv Mini-App (WebContainer)"
                    style={{ height: "100%", width: "100%", border: "none", background: "#fff" }}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
            )}
        </div>
    );
}
