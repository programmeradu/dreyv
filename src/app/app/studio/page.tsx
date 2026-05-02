"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Eye,
    Terminal,
    FileCode,
    FileText,
    Hash,
    Cpu,
    Shield,
    FolderOpen,
    BookOpen,
    Plus,
    Code2,
} from "lucide-react";
import { useSelf } from "@/liveblocks.config";
import { getAvatarUrl } from "@/lib/avatars";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PromptChat } from "@/components/studio/PromptChat";
import { CodeEditor } from "@/components/studio/CodeEditor";
import { LivePreview } from "@/components/studio/LivePreview";
import { ContractEditor } from "@/components/studio/ContractEditor";

import { compileProgram } from "@/lib/studio/solana-playground";
import { saveProject } from "@/actions/studio-actions";
import { PremiumModal, PremiumModalTitle, PremiumModalDescription } from "@/components/ui/PremiumModal";
import { toast } from "@/lib/toast-notifications";
import { ProjectBrowser } from "@/components/studio/ProjectBrowser";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { useStudioCapabilities } from "@/lib/studio/use-capabilities";
import { buildPreviewHtml } from "@/lib/studio/preview-html";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@/lib/wallet/compat";
import { TemplateGallery } from "@/components/studio/TemplateGallery";
import { SDKReferencePanel } from "@/components/studio/SDKReferencePanel";
import { CommandPalette, type PaletteCommand } from "@/components/studio/CommandPalette";
import { GlobalSearch } from "@/components/studio/GlobalSearch";
import { DiffReview, FileHistory } from "@/components/studio/DiffReview";
import { type ProjectTemplate } from "@/lib/studio/templates";
import { EmptyState } from "@/components/studio/EmptyState";
import { PlanStepper } from "@/components/studio/PlanStepper";
import { ArchitectEngine } from "@/lib/studio/architect-engine";
import { KeyWizardModal } from "@/components/studio/KeyWizardModal";
import { DreyvStar } from "@/components/studio/DreyvStar";

interface StudioFile {
    name: string;
    content: string;
    language: string;
}

// Helper to determine file icon
const FileIcon = ({ fileName, active }: { fileName: string; active: boolean }) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const color = active ? "text-emerald-400" : "text-muted-foreground/60";

    if (ext === 'tsx' || ext === 'ts') return <FileCode size={14} className={color} strokeWidth={2.5} />;
    if (ext === 'css') return <Hash size={14} className={color} strokeWidth={2.5} />;
    if (ext === 'rs') return <Cpu size={14} className={color} strokeWidth={2.5} />;
    return <FileText size={14} className={color} strokeWidth={2.5} />;
};

const DEFAULT_FILES: Record<string, StudioFile> = {
    "App.tsx": {
        name: "App.tsx",
        content: `import { useVault } from '@keystone-os/sdk';

export default function App() {
  const { tokens } = useVault();

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50 animate-pulse"></div>
        <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">System Ready</span>
      </div>
      
      <h1 className="text-4xl font-bold tracking-tight mb-4 text-white">
        dreyv <span className="text-emerald-400">Architect</span> Node
      </h1>
      
      <p className="text-zinc-400 max-w-2xl mb-8 leading-relaxed text-lg">
        Treasury OS construction environment initialized.
        Use the AI Architect to synthesize custom mini-apps.
      </p>

      <div className="grid gap-3 mb-12">
        {tokens.map((token) => (
          <div key={token.symbol} className="flex items-center justify-between p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:border-emerald-400/20 transition-all">
            <div className="flex items-center gap-3">
              {token.logoURI ? (
                <img src={token.logoURI} alt={token.symbol} className="w-8 h-8 rounded-full" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-400">{token.symbol[0]}</div>
              )}
              <div>
                <p className="font-bold text-white">{token.symbol}</p>
                <p className="text-xs text-zinc-500">{token.name}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-mono font-bold text-white">{token.balance.toLocaleString()}</p>
              <p className="text-xs text-emerald-400">\${(token.balance * token.price).toLocaleString()}</p>
            </div>
          </div>
        ))}
      </div>
      
      <div className="text-center text-zinc-600 text-[10px] font-bold uppercase tracking-[0.3em] pt-8 border-t border-zinc-900/50">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-3 animate-pulse"></span>
        Ask the Architect to build something
      </div>
    </div>
  );
}`,
        language: "typescript",
    },
    "utils.ts": {
        name: "utils.ts",
        content: `// dreyv Utility Suite
export const formatUSD = (val: number) => 
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

export const cn = (...classes: string[]) => classes.filter(Boolean).join(' ');
`,
        language: "typescript",
    },
    "styles.css": {
        name: "styles.css",
        content: `/* dreyv Design System */
body {
  margin: 0;
  background: #09090b;
  color: white;
  font-family: system-ui, sans-serif;
}
`,
        language: "css",
    },
    "lib.rs": {
        name: "lib.rs",
        content: `use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod dreyv_contract {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("dreyv Vault Initialized");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}`,
        language: "rust",
    },
};

export default function StudioPage() {
    const user = useSelf();
    const { publicKey } = useWallet();
    const [appName, setAppName] = useState("Untitled Mini-App");
    const [files, setFiles] = useState<Record<string, StudioFile>>({ ...DEFAULT_FILES });
    const [activeFile, setActiveFile] = useState("App.tsx");
    const [isGenerating, setIsGenerating] = useState(false);
    const [isCompiling, setIsCompiling] = useState(false);
    const [activeTab, setActiveTab] = useState<"preview" | "code" | "contract">("preview");
    const [viewMode, setViewMode] = useState<"code" | "preview">("preview");
    
    const [programBuffer, setProgramBuffer] = useState<Buffer | null>(null);
    const [isDeploying, setIsDeploying] = useState(false);
    const [runtimeLogs, setRuntimeLogs] = useState<string[]>([]);

    // Persistence State
    const [currentAppId, setCurrentAppId] = useState<string | undefined>(undefined);
    const [showProjectBrowser, setShowProjectBrowser] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [projectBrowserUserId, setProjectBrowserUserId] = useState("Operator");

    // Header state — dirty tracking, last-save, last-test status
    const [isDirty, setIsDirty] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [lastTestStatus, setLastTestStatus] = useState<"none" | "passed" | "failed" | "running">("none");
    const [lastTestMode, setLastTestMode] = useState<"real" | "static-lint" | null>(null);
    const { caps } = useStudioCapabilities();

    // New component states
    const [showTemplateGallery, setShowTemplateGallery] = useState(false);
    const [showSDKReference, setShowSDKReference] = useState(false);
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [showGlobalSearch, setShowGlobalSearch] = useState(false);
    const [pendingDiff, setPendingDiff] = useState<{ fileName: string; original: string; modified: string } | null>(null);
    const fileHistoryRef = useRef(new FileHistory());

    // ─── Empty-state / Plan-stepper flow ─────────────────────────
    const [emptyStatePrompt, setEmptyStatePrompt] = useState<string | null>(null);
    const [isPlannerBuilding, setIsPlannerBuilding] = useState(false);
    const [showEmptyState, setShowEmptyState] = useState(true);
    const stepperStartRef = useRef<number>(0);
    const stepperEngineRef = useRef<ArchitectEngine | null>(null);

    // ─── Dreyv Connector Key Wizard ──────────────────────────────
    const [wizardProvider, setWizardProvider] = useState<string | null>(null);
    useEffect(() => {
        function onConnReq(e: Event) {
            const detail = (e as CustomEvent).detail as { provider?: string } | undefined;
            if (detail?.provider) setWizardProvider(detail.provider);
        }
        window.addEventListener("dreyv:connection_required", onConnReq);
        return () => window.removeEventListener("dreyv:connection_required", onConnReq);
    }, []);

    const searchParams = useSearchParams();
    const hasLoadedFromUrl = useRef(false);

    useEffect(() => {
        const resolvedUserId = publicKey?.toBase58() || user?.info?.name || "Operator";
        setProjectBrowserUserId(resolvedUserId);
    }, [user?.info?.name, publicKey]);

    // Load project from ?appId= query param on mount.
    // Tries localStorage first (fast, restores unsaved work after refresh),
    // then falls back to DB if there's a saved project.
    useEffect(() => {
        if (hasLoadedFromUrl.current) return;
        const appIdParam = searchParams.get("appId");
        if (!appIdParam) return;
        hasLoadedFromUrl.current = true;
        setCurrentAppId(appIdParam);

        // 1. Try localStorage snapshot
        try {
            const raw = localStorage.getItem(`dreyv:studio:${appIdParam}`);
            if (raw) {
                const snap = JSON.parse(raw);
                if (snap?.files && Object.keys(snap.files).length > 0) {
                    setFiles(snap.files);
                    setAppName(snap.appName || "Untitled Mini-App");
                    const first = Object.keys(snap.files)[0];
                    setActiveFile(snap.files["App.tsx"] ? "App.tsx" : first);
                    setShowEmptyState(false);
                    setEmptyStatePrompt(null);
                }
            }
        } catch (e) { console.warn("[Studio] localStorage restore failed:", e); }

        // 2. Then try DB (overrides local if found)
        (async () => {
            try {
                const { getProject } = await import("@/actions/studio-actions");
                const project = await getProject(appIdParam);
                if (project) handleLoadProject(project);
            } catch (e) { console.warn("[Studio] Failed to load from DB:", e); }
        })();
    }, [searchParams]);

    // Autosave to localStorage whenever files/appName change.
    // Ensures refresh never wipes unsaved work.
    useEffect(() => {
        if (showEmptyState) return;
        let appId = currentAppId;
        if (!appId) {
            appId = "app_" + Math.random().toString(36).substring(2, 13);
            setCurrentAppId(appId);
            try { window.history.replaceState({}, "", `/app/studio?appId=${appId}`); } catch {}
        }
        try {
            const snap = { appName, files, savedAt: Date.now() };
            localStorage.setItem(`dreyv:studio:${appId}`, JSON.stringify(snap));
        } catch (e) { /* quota / SSR */ }
    }, [files, appName, currentAppId, showEmptyState]);

    const handleNewProject = () => {
        setShowTemplateGallery(true);
    };

    const handleNewBlankProject = () => {
        setAppName("Untitled Mini-App");
        setCurrentAppId(undefined);
        setFiles({ ...DEFAULT_FILES });
        setActiveFile("App.tsx");
        setRuntimeLogs([]);
        setProgramBuffer(null);
        setActiveTab("preview");
        window.history.replaceState({}, "", "/app/studio");
        setShowTemplateGallery(false);
        setShowEmptyState(false);
        setEmptyStatePrompt(null);
        toast.info("New project created.");
    };

    // ─── Empty-state / Plan-stepper handlers ────────────────────
    const handleEmptyStateSubmit = useCallback((prompt: string) => {
        setEmptyStatePrompt(prompt);
    }, []);

    const handleStepperCancel = useCallback(() => {
        setEmptyStatePrompt(null);
        setIsPlannerBuilding(false);
        stepperEngineRef.current?.abort();
    }, []);

    const logStudioRun = useCallback(
        async (payload: Record<string, unknown>) => {
            try {
                await fetch("/api/studio/log-run", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
            } catch {
                // best-effort telemetry
            }
        },
        []
    );

    const handlePlannerBuild = useCallback(
        async (payload: {
            prompt: string;
            answers: Record<string, string | string[]>;
            chosenIntegrations: Array<{ id: string; name: string; status: string }>;
            researchContext: string;
            category: string;
            unknownProtocols: string[];
        }) => {
            setIsPlannerBuilding(true);
            stepperStartRef.current = Date.now();

            const enrichedPrompt = `${payload.prompt}

[CLARIFYING ANSWERS]
${Object.entries(payload.answers)
                    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
                    .join("\n")}

[CHOSEN INTEGRATIONS]
${payload.chosenIntegrations.map((i) => `- ${i.name}`).join("\n") || "- (none specified)"}

[HARD RULES]
- No mocks, stubs, placeholders, lorem text, or dummy/fake data.
- All data must come from useFetch() or @keystone-os/sdk hooks.
- If a value isn't known, accept it as a prop or input — never hardcode a fake.`;

            const contextFiles: Record<string, { content: string }> = {};
            for (const [name, file] of Object.entries(files)) {
                contextFiles[name] = { content: file.content };
            }

            let analyzerOutcome: "CLEAN" | "CORRECTED" | "FAILED" = "FAILED";
            let attempts = 0;
            let resultErrors: string[] = [];

            const engine = new ArchitectEngine({
                onStateChange: (s) => {
                    attempts = s.attempt;
                    if (s.state === "CLEAN") analyzerOutcome = s.attempt > 0 ? "CORRECTED" : "CLEAN";
                    if (s.state === "FAILED") analyzerOutcome = "FAILED";
                },
                onFilesGenerated: (gen) => {
                    applyFilesRef.current?.(gen);
                    setShowEmptyState(false);
                    setEmptyStatePrompt(null);
                    setIsPlannerBuilding(false);
                    toast.success("Build complete!", {
                        description: `Generated ${Object.keys(gen).length} file(s).`,
                    });
                    logStudioRun({
                        prompt: payload.prompt,
                        promptCategory: payload.category,
                        clarifyAnswers: payload.answers,
                        chosenIntegrations: payload.chosenIntegrations,
                        unknownProtocols: payload.unknownProtocols,
                        analyzerOutcome,
                        attempts,
                        shipped: false,
                        errors: resultErrors,
                        durationMs: Date.now() - stepperStartRef.current,
                    });
                },
                onExplanation: () => { /* no-op for stepper flow */ },
                onError: (err) => {
                    resultErrors = [err];
                    setIsPlannerBuilding(false);
                    toast.error("Build failed", { description: err.slice(0, 200) });
                    logStudioRun({
                        prompt: payload.prompt,
                        promptCategory: payload.category,
                        clarifyAnswers: payload.answers,
                        chosenIntegrations: payload.chosenIntegrations,
                        unknownProtocols: payload.unknownProtocols,
                        analyzerOutcome: "FAILED",
                        attempts,
                        shipped: false,
                        errors: [err],
                        durationMs: Date.now() - stepperStartRef.current,
                    });
                },
            });

            stepperEngineRef.current = engine;

            try {
                await engine.generate(
                    enrichedPrompt,
                    contextFiles,
                    [],
                    payload.researchContext || undefined
                );
            } catch (err) {
                console.error("[Studio] Planner build failed:", err);
                setIsPlannerBuilding(false);
            }
        },
        [files, logStudioRun]
    );

    // Forward ref to applyGeneratedFiles (declared below) so the planner callback
    // can call it without forward-reference TS errors.
    const applyFilesRef = useRef<((files: Record<string, string>) => void) | null>(null);

    const handleSelectTemplate = (template: ProjectTemplate) => {
        const newFiles: Record<string, StudioFile> = {};
        for (const [name, content] of Object.entries(template.files)) {
            const ext = name.split(".").pop() || "";
            const langMap: Record<string, string> = {
                tsx: "typescript", ts: "typescript", js: "javascript", jsx: "javascript",
                css: "css", json: "json", rs: "rust", html: "html", toml: "toml",
            };
            newFiles[name] = { name, content, language: langMap[ext] || "plaintext" };
        }
        // Ensure utils and styles exist
        if (!newFiles["utils.ts"]) {
            newFiles["utils.ts"] = { ...DEFAULT_FILES["utils.ts"] };
        }
        if (!newFiles["styles.css"]) {
            newFiles["styles.css"] = { ...DEFAULT_FILES["styles.css"] };
        }
        setAppName(template.name);
        setCurrentAppId(undefined);
        setFiles(newFiles);
        setActiveFile("App.tsx");
        setRuntimeLogs([]);
        setProgramBuffer(null);
        setActiveTab("preview");
        setShowTemplateGallery(false);
        setShowEmptyState(false);
        setEmptyStatePrompt(null);
        window.history.replaceState({}, "", "/app/studio");
        toast.success(`Loaded template: ${template.name}`);
    };

    const handleCodeChange = useCallback((newCode: string) => {
        setFiles((prev) => ({
            ...prev,
            [activeFile]: {
                ...prev[activeFile],
                content: newCode,
            },
        }));
        setIsDirty(true);
    }, [activeFile]);

    const handleAIGenerate = useCallback(async (generatedFiles: Record<string, string>) => {
        // Save snapshots of files being overwritten for diff review
        for (const [name] of Object.entries(generatedFiles)) {
            const existing = files[name];
            if (existing) {
                fileHistoryRef.current.saveSnapshot(name, existing.content, "Before AI edit");
            }
        }

        // If App.tsx is being changed, show diff review
        if (generatedFiles["App.tsx"] && files["App.tsx"]) {
            setPendingDiff({
                fileName: "App.tsx",
                original: files["App.tsx"].content,
                modified: generatedFiles["App.tsx"],
            });
            // Store all generated files for when user accepts
            pendingFilesRef.current = generatedFiles;
            return;
        }

        // No diff review needed — apply directly
        applyGeneratedFiles(generatedFiles);
    }, [files]);

    const pendingFilesRef = useRef<Record<string, string> | null>(null);

    const applyGeneratedFiles = useCallback((generatedFiles: Record<string, string>) => {
        const newFiles: Record<string, StudioFile> = {};
        for (const [name, content] of Object.entries(generatedFiles)) {
            const ext = name.split(".").pop() || "";
            const langMap: Record<string, string> = {
                tsx: "typescript", ts: "typescript", js: "javascript", jsx: "javascript",
                css: "css", json: "json", rs: "rust", html: "html", toml: "toml",
            };
            newFiles[name] = { name, content, language: langMap[ext] || "plaintext" };
        }
        setFiles((prev) => ({ ...prev, ...newFiles }));
        if (generatedFiles["App.tsx"]) {
            setActiveFile("App.tsx");
        }
        // Hide empty state once any AI-generated content lands
        setShowEmptyState(false);
        setEmptyStatePrompt(null);
    }, []);

    // Wire the forward ref so the planner callback can call applyGeneratedFiles
    useEffect(() => {
        applyFilesRef.current = applyGeneratedFiles;
    }, [applyGeneratedFiles]);

    const handleDiffAccept = useCallback((code: string) => {
        const allFiles = pendingFilesRef.current || {};
        allFiles["App.tsx"] = code; // Use the (possibly edited) version from diff view
        applyGeneratedFiles(allFiles);
        setPendingDiff(null);
        pendingFilesRef.current = null;
    }, [applyGeneratedFiles]);

    const handleDiffReject = useCallback(() => {
        setPendingDiff(null);
        pendingFilesRef.current = null;
        toast.info("Changes rejected.");
    }, []);



    const handleSave = async () => {
        setIsSaving(true);
        const toastId = toast.loading("Saving project...");

        try {
            const appId = currentAppId || "app_" + Math.random().toString(36).substring(2, 15);
            const creatorWallet = publicKey?.toBase58() || user?.info?.name || "Operator";

            const projectCode = {
                files: Object.entries(files).reduce((acc, [name, file]) => ({
                    ...acc,
                    [name]: { content: file.content }
                }), {} as Record<string, { content: string }>)
            };

            // Save to DB
            await saveProject(
                creatorWallet,
                projectCode,
                { name: appName, description: "Created in dreyv Studio" },
                appId
            );

            setCurrentAppId(appId);
            setIsDirty(false);
            setLastSavedAt(Date.now());
            toast.dismiss(toastId);
            toast.success("Project saved!", {
                description: `"${appName}" saved. Open My Projects to load it later.`,
            });
        } catch (error) {
            console.error(error);
            toast.dismiss(toastId);
            toast.error("Failed to save project.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleLoadProject = (project: any) => {
        setAppName(project.name);
        setCurrentAppId(project.id);

        // Restore files
        const loadedFiles: Record<string, StudioFile> = {};
        if (project.code && project.code.files) {
            Object.entries(project.code.files).forEach(([name, file]: [string, any]) => {
                loadedFiles[name] = {
                    name,
                    content: file.content,
                    language: name.endsWith("json") ? "json" :
                        name.endsWith("css") ? "css" :
                            name.endsWith("rs") ? "rust" : "typescript"
                };
            });
        }
        setFiles(loadedFiles);
        const loadedFileNames = Object.keys(loadedFiles);
        setActiveFile(loadedFileNames[0] || "App.tsx");
        setShowEmptyState(false);
        setEmptyStatePrompt(null);
        toast.success(`Loaded "${project.name}"`);
    };

    // Ship Mini-App to Library
    const handleShip = async () => {
        setIsDeploying(true);
        const toastId = toast.loading("Shipping to Library...");

        try {
            const appId = currentAppId || "app_" + Math.random().toString(36).substring(2, 15);
            const creatorWallet = publicKey?.toBase58() || user?.info?.name || "Operator";

            const projectCode = {
                files: Object.entries(files).reduce((acc, [name, file]) => ({
                    ...acc,
                    [name]: { content: file.content }
                }), {} as Record<string, { content: string }>),
            };

            // Save to DB
            await saveProject(
                creatorWallet,
                projectCode,
                { name: appName, description: "Built in dreyv Studio by " + creatorWallet },
                appId
            );

            setCurrentAppId(appId);
            setIsDirty(false);
            setLastSavedAt(Date.now());

            toast.dismiss(toastId);
            toast.success("Shipped to Library!", {
                description: `"${appName}" is ready to launch.`,
                action: {
                    label: "Open Library",
                    onClick: () => window.location.href = "/app/library",
                },
            });

            setRuntimeLogs(prev => [...prev, `[System] Shipped "${appName}" to Library (${appId})`]);

        } catch (error: any) {
            toast.dismiss(toastId);
            toast.error(`Ship failed: ${error.message}`);
            console.error("Ship error:", error);
        } finally {
            setIsDeploying(false);
        }
    };

    const handleCompile = async () => {
        setIsCompiling(true);
        const toastId = toast.loading("Compiling Anchor program...");
        try {
            const result = await compileProgram(files as any); // Type cast for now
            toast.success("Compilation complete! IDL generated.");

            // Add IDL to files so user can see it
            setFiles(prev => ({
                ...prev,
                "idl.json": {
                    name: "idl.json",
                    content: JSON.stringify(result.idl, null, 2),
                    language: "json"
                }
            }));

            // Mock buffer for now
            setProgramBuffer(Buffer.from("Mock Program Binary"));

        } catch (e) {
            toast.error("Compilation failed.");
        } finally {
            toast.dismiss(toastId);
            setIsCompiling(false);
        }
    };

    // ─── Preview / PDF / Test handlers (moved from StudioToolbar) ───
    const handlePreview = useCallback(async () => {
        if (!caps.browserRendering) {
            toast.error("Preview unavailable", { description: "Browser Rendering is not configured on the server." });
            return;
        }
        setIsPreviewing(true);
        try {
            const code = files["App.tsx"]?.content || "";
            const res = await fetch("/api/studio/screenshot", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ html: buildPreviewHtml(code), width: 800, height: 600 }),
            });
            if (!res.ok) throw new Error(`Screenshot failed: ${res.status}`);
            const data = await res.json();
            if (data.dataUrl) {
                const w = window.open("", "_blank");
                if (w) w.document.write(`<title>Preview — ${appName}</title><img src="${data.dataUrl}" style="max-width:100%"/>`);
            }
            toast.success("Preview captured");
        } catch (err: any) {
            toast.error("Preview failed", { description: err.message });
        } finally {
            setIsPreviewing(false);
        }
    }, [caps.browserRendering, files, appName]);

    const handleExportPdf = useCallback(async () => {
        if (!caps.browserRendering) {
            toast.error("PDF export unavailable", { description: "Browser Rendering is not configured on the server." });
            return;
        }
        setIsExporting(true);
        const toastId = toast.loading("Generating PDF...");
        try {
            const code = files["App.tsx"]?.content || "";
            const res = await fetch("/api/studio/export-pdf", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ html: buildPreviewHtml(code), format: "A4", title: appName }),
            });
            if (!res.ok) throw new Error(`PDF export failed: ${res.status}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${appName.toLowerCase().replace(/\s+/g, "-")}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast.dismiss(toastId);
            toast.success("PDF exported");
        } catch (err: any) {
            toast.dismiss(toastId);
            toast.error("PDF export failed", { description: err.message });
        } finally {
            setIsExporting(false);
        }
    }, [caps.browserRendering, files, appName]);

    const handleTest = useCallback(async () => {
        setIsTesting(true);
        setLastTestStatus("running");
        try {
            const code = files["App.tsx"]?.content || "";
            const payload = caps.browserRendering
                ? { html: buildPreviewHtml(code), code, appName }
                : { code, appName };
            const res = await fetch("/api/studio/test-app", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            const passed = data.passed ?? false;
            setLastTestStatus(passed ? "passed" : "failed");
            setLastTestMode(data.mode === "real" ? "real" : "static-lint");
            const label = data.mode === "real" ? "Smoke test" : "Lint check";
            if (passed) toast.success(`${label} passed`, { description: `Score: ${data.score}/100` });
            else toast.error(`${label} failed`, { description: `Score: ${data.score}/100` });
        } catch (err: any) {
            setLastTestStatus("failed");
            setLastTestMode("static-lint");
            toast.error("Test failed", { description: err.message });
        } finally {
            setIsTesting(false);
        }
    }, [caps.browserRendering, files, appName]);


    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key === "k" && !e.shiftKey) {
                e.preventDefault();
                setShowCommandPalette(prev => !prev);
            } else if (mod && e.shiftKey && e.key === "F") {
                e.preventDefault();
                setShowGlobalSearch(prev => !prev);
            } else if (mod && e.key === "s") {
                e.preventDefault();
                handleSave();
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, []);

    // ─── Command Palette Commands ───────────────────────────────
    const paletteCommands: PaletteCommand[] = React.useMemo(() => [
        { id: "new-blank", label: "New Blank Project", category: "Project", shortcut: "", action: handleNewBlankProject },
        { id: "new-template", label: "New from Template", category: "Project", action: () => setShowTemplateGallery(true) },
        { id: "open-projects", label: "Open Projects", category: "Project", shortcut: "", action: () => setShowProjectBrowser(true) },
        { id: "save", label: "Save Project", category: "Project", shortcut: "⌘S", action: handleSave },
        { id: "ship", label: "Ship to Library", category: "Project", action: handleShip },
        { id: "sdk-ref", label: "Toggle SDK Reference", category: "View", action: () => setShowSDKReference(prev => !prev) },
        { id: "global-search", label: "Search in Files", category: "View", shortcut: "⌘⇧F", action: () => setShowGlobalSearch(true) },
        { id: "toggle-view", label: "Toggle Code / Preview", category: "View", action: () => setViewMode(prev => prev === "code" ? "preview" : "code") },
        { id: "show-code", label: "Show Code", category: "View", action: () => setViewMode("code") },
        { id: "show-preview", label: "Show Preview", category: "View", action: () => { setViewMode("preview"); setActiveTab("preview"); } },
        { id: "show-console", label: "Show Console", category: "View", action: () => { setViewMode("preview"); setActiveTab("code"); } },
    ], []);
    // ─── GlobalSearch Handlers ──────────────────────────────────
    const handleSearchNavigate = useCallback((fileName: string, _line: number) => {
        setActiveFile(fileName);
        setShowGlobalSearch(false);
    }, []);

    const handleSearchReplaceAll = useCallback((replacements: { fileName: string; content: string }[]) => {
        setFiles(prev => {
            const next = { ...prev };
            for (const r of replacements) {
                if (next[r.fileName]) {
                    next[r.fileName] = { ...next[r.fileName], content: r.content };
                }
            }
            return next;
        });
        toast.success(`Replaced in ${replacements.length} file(s)`);
    }, []);

    return (
        <div className="h-dvh md:h-screen flex flex-col bg-white text-slate-900 selection:bg-violet-200 overflow-hidden min-h-0 font-[Manrope,sans-serif]">
            {/* Mobile gate — Studio is a desktop IDE */}
            <div className="md:hidden flex-1 flex flex-col items-center justify-center px-6 py-10 text-center gap-5 overflow-y-auto">
                <div className="w-16 h-16 rounded-2xl bg-violet-50 border border-violet-200 flex items-center justify-center">
                    <DreyvStar size={28} className="text-violet-600" />
                </div>
                <div className="space-y-2 max-w-sm">
                    <h1 className="text-xl font-bold tracking-tight text-slate-900">Studio is desktop‑only</h1>
                    <p className="text-sm text-slate-600 leading-relaxed">
                        The AI Architect, code editor, and live preview need room to breathe. Open dreyv on a laptop or larger tablet to build and ship apps.
                    </p>
                </div>
                <div className="flex flex-col gap-2 w-full max-w-xs">
                    <a href="/app" className="inline-flex items-center justify-center h-10 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors">
                        Back to dashboard
                    </a>
                    <a href="/app/marketplace" className="inline-flex items-center justify-center h-10 rounded-xl border border-violet-200 bg-white text-violet-700 text-sm font-semibold hover:bg-violet-50 transition-colors">
                        Browse marketplace
                    </a>
                </div>
            </div>

            <div className="hidden md:flex md:flex-col md:flex-1 md:min-h-0">
            {/* Studio Header v2 — capabilities-aware status bar */}
            <StudioHeader
                appName={appName}
                onAppNameChange={(v) => { setAppName(v); setIsDirty(true); }}
                isDirty={isDirty}
                isSaving={isSaving}
                lastSavedAt={lastSavedAt}
                onSave={handleSave}
                fileCount={Object.keys(files).length}
                onOpenFiles={() => setShowProjectBrowser(true)}
                lastTestStatus={lastTestStatus}
                lastTestMode={lastTestMode}
                onRunTest={handleTest}
                isTesting={isTesting}
                walletLabel={publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : "Connect"}
                
                onNewProject={handleNewProject}
                onOpenProjects={() => setShowProjectBrowser(true)}
                onToggleSDK={() => setShowSDKReference((prev) => !prev)}
                onPreview={handlePreview}
                isPreviewing={isPreviewing}
                onExportPdf={handleExportPdf}
                isExporting={isExporting}
                onShip={handleShip}
                isShipping={isDeploying}
                caps={caps}
            />


            {/* Main Studio Area */}
            {/* Main Studio Area */}
            <div className="flex-1 relative overflow-hidden min-h-0">
                {/* Empty-state / Plan-stepper overlay */}
                {showEmptyState && !emptyStatePrompt && (
                    <EmptyState
                        onSubmit={handleEmptyStateSubmit}
                        onOpenTemplates={() => setShowTemplateGallery(true)}
                        onOpenRecent={() => setShowProjectBrowser(true)}
                    />
                )}
                {emptyStatePrompt && (
                    <PlanStepper
                        prompt={emptyStatePrompt}
                        onCancel={handleStepperCancel}
                        onBuild={handlePlannerBuild}
                        isBuilding={isPlannerBuilding}
                    />
                )}

                <ResizablePanelGroup direction="horizontal" className="h-full overflow-hidden min-h-0">
                {/* Left Panel: AI Chat */}
                <ResizablePanel defaultSize={32} minSize={18} maxSize={60}>
                    <div className="h-full flex flex-col bg-slate-50/60 border-r border-slate-200/70 overflow-hidden min-h-0 min-w-0">
                        <div className="px-3 py-2.5 border-b border-slate-200/70 flex items-center justify-between bg-white shrink-0 min-w-0 gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <DreyvStar size={12} className="text-violet-600 shrink-0" />
                                <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-600 truncate">
                                    AI Architect
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                <div className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                                <span className="text-[9px] font-semibold text-violet-600/80 tracking-widest uppercase">Active</span>
                            </div>
                        </div>
                        <div className="flex-1 overflow-hidden min-h-0 min-w-0">
                            <PromptChat
                                onGenerate={handleAIGenerate}
                                isGenerating={isGenerating}
                                setIsGenerating={setIsGenerating}
                                userFiles={files}
                                runtimeLogs={runtimeLogs}
                            />
                        </div>
                    </div>
                </ResizablePanel>

                <ResizableHandle withHandle />

                {/* Right Panel: Code OR Preview (toggle) */}
                <ResizablePanel defaultSize={68} minSize={30}>
                    <div className="h-full flex flex-col bg-white min-h-0 min-w-0 overflow-hidden">
                        {/* Top bar: Code/Preview segmented toggle + contextual sub-tabs */}
                        <div className="flex items-center justify-between gap-3 px-3 h-10 border-b border-slate-200/70 bg-white shrink-0 min-w-0 overflow-hidden">
                            {/* Segmented Code | Preview toggle */}
                            <div className="flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200/80 shrink-0">
                                <button
                                    onClick={() => setViewMode("code")}
                                    className={`flex items-center gap-1.5 px-3 h-7 text-[11px] font-semibold rounded-md transition-all ${
                                        viewMode === "code"
                                            ? "bg-white text-violet-700 shadow-sm border border-violet-100"
                                            : "text-slate-500 hover:text-slate-800"
                                    }`}
                                >
                                    <Code2 size={13} strokeWidth={2.4} />
                                    <span>Code</span>
                                </button>
                                <button
                                    onClick={() => setViewMode("preview")}
                                    className={`flex items-center gap-1.5 px-3 h-7 text-[11px] font-semibold rounded-md transition-all ${
                                        viewMode === "preview"
                                            ? "bg-white text-violet-700 shadow-sm border border-violet-100"
                                            : "text-slate-500 hover:text-slate-800"
                                    }`}
                                >
                                    <Eye size={13} strokeWidth={2.4} />
                                    <span>Preview</span>
                                </button>
                            </div>

                            {/* Contextual right side */}
                            {viewMode === "code" ? (
                                <div className="flex items-center gap-0.5 overflow-x-auto min-w-0 flex-1 scrollbar-thin">
                                    {Object.keys(files).map((fileName) => (
                                        <button
                                            key={fileName}
                                            onClick={() => setActiveFile(fileName)}
                                            className={`group flex items-center gap-1.5 px-2.5 h-7 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                                                activeFile === fileName
                                                    ? "bg-violet-50 text-violet-700"
                                                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                                            }`}
                                        >
                                            <FileIcon fileName={fileName} active={activeFile === fileName} />
                                            <span>{fileName}</span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-thin">
                                    {([
                                        { id: "preview", label: "Preview", icon: Eye },
                                        { id: "code", label: "Console", icon: Terminal },
                                        { id: "contract", label: "Contracts", icon: Cpu },
                                    ] as const).map((t) => {
                                        const active = activeTab === t.id;
                                        const Icon = t.icon;
                                        return (
                                            <button
                                                key={t.id}
                                                onClick={() => setActiveTab(t.id)}
                                                className={`flex items-center gap-1.5 px-2.5 h-7 text-[11px] font-medium rounded-md transition-colors ${
                                                    active
                                                        ? "bg-violet-50 text-violet-700"
                                                        : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                                                }`}
                                            >
                                                <Icon size={13} strokeWidth={2.2} />
                                                <span>{t.label}</span>
                                                {t.id === "code" && runtimeLogs.length > 0 && (
                                                    <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Body */}
                        <div className="flex-1 relative overflow-hidden min-h-0 min-w-0">
                            {viewMode === "code" ? (
                                <CodeEditor
                                    code={files[activeFile]?.content || ""}
                                    language={files[activeFile]?.language || "typescript"}
                                    onChange={handleCodeChange}
                                    fileName={activeFile}
                                    allFiles={files}
                                    isGenerating={isGenerating}
                                />
                            ) : activeTab === "contract" ? (
                                <ContractEditor
                                    files={files}
                                    onCompile={handleCompile}
                                    isCompiling={isCompiling}
                                />
                            ) : (
                                <LivePreview
                                    files={files}
                                    tab={activeTab as "preview" | "code"}
                                    onLogsChange={(newLogs) => setRuntimeLogs(newLogs)}
                                    walletAddress={publicKey?.toBase58() || null}
                                    appId={currentAppId}
                                />
                            )}
                        </div>
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>
            </div>
            </div>



            <ProjectBrowser
                userId={projectBrowserUserId}
                isOpen={showProjectBrowser}
                onClose={() => setShowProjectBrowser(false)}
                onLoadProject={handleLoadProject}
                onNewProject={handleNewProject}
            />

            {/* Template Gallery */}
            <TemplateGallery
                isOpen={showTemplateGallery}
                onClose={() => setShowTemplateGallery(false)}
                onSelectTemplate={handleSelectTemplate}
                onBlank={handleNewBlankProject}
            />

            {/* SDK Reference Panel */}
            <SDKReferencePanel
                isOpen={showSDKReference}
                onClose={() => setShowSDKReference(false)}
            />

            {/* Command Palette */}
            <CommandPalette
                commands={paletteCommands}
                isOpen={showCommandPalette}
                onClose={() => setShowCommandPalette(false)}
            />

            {/* Global Search */}
            <GlobalSearch
                files={files}
                isOpen={showGlobalSearch}
                onClose={() => setShowGlobalSearch(false)}
                onNavigate={handleSearchNavigate}
                onReplaceAll={handleSearchReplaceAll}
            />

            {/* Diff Review */}
            {pendingDiff && (
                <DiffReview
                    fileName={pendingDiff.fileName}
                    originalCode={pendingDiff.original}
                    modifiedCode={pendingDiff.modified}
                    language="typescript"
                    onAccept={handleDiffAccept}
                    onReject={handleDiffReject}
                    isOpen={true}
                />
            )}

            {/* Dreyv Connector Key Wizard — auto-popup when a mini-app needs credentials */}
            <KeyWizardModal
                open={wizardProvider !== null}
                onClose={() => setWizardProvider(null)}
                providerId={wizardProvider}
                onSaved={(p) => toast.success(`${p} connected — re-run your mini-app.`)}
            />
        </div>
    );
}
