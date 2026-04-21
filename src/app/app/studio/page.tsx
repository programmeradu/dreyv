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
    MoreHorizontal,
    Save as SaveIcon,
    ChevronDown,
    Code2,
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSelf } from "@/liveblocks.config";
import { getAvatarUrl } from "@/lib/avatars";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PromptChat } from "@/components/studio/PromptChat";
import { CodeEditor } from "@/components/studio/CodeEditor";
import { LivePreview } from "@/components/studio/LivePreview";
import { ContractEditor } from "@/components/studio/ContractEditor";
import { WalletManager } from "@/components/studio/WalletManager";
import { compileProgram } from "@/lib/studio/solana-playground";
import { saveProject } from "@/actions/studio-actions";
import { PremiumModal, PremiumModalTitle, PremiumModalDescription } from "@/components/ui/PremiumModal";
import { toast } from "@/lib/toast-notifications";
import { ProjectBrowser } from "@/components/studio/ProjectBrowser";
import { StudioToolbar } from "@/components/studio/StudioToolbar";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
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
    const [activeTab, setActiveTab] = useState<"preview" | "code" | "console" | "contract">("preview");
    const [showWalletModal, setShowWalletModal] = useState(false);
    const [programBuffer, setProgramBuffer] = useState<Buffer | null>(null);
    const [isDeploying, setIsDeploying] = useState(false);
    const [runtimeLogs, setRuntimeLogs] = useState<string[]>([]);

    // Persistence State
    const [currentAppId, setCurrentAppId] = useState<string | undefined>(undefined);
    const [showProjectBrowser, setShowProjectBrowser] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [projectBrowserUserId, setProjectBrowserUserId] = useState("Operator");

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

    // Load project from ?appId= query param on mount
    useEffect(() => {
        if (hasLoadedFromUrl.current) return;
        const appIdParam = searchParams.get("appId");
        if (!appIdParam) return;
        hasLoadedFromUrl.current = true;

        // Load from DB
        (async () => {
            try {
                const { getProject } = await import("@/actions/studio-actions");
                const project = await getProject(appIdParam);
                if (project) handleLoadProject(project);
            } catch (e) { console.warn("[Studio] Failed to load from DB:", e); }
        })();
    }, [searchParams]);

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

    // ─── Keyboard Shortcuts ─────────────────────────────────────
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
        { id: "toggle-console", label: "Toggle Console", category: "View", action: () => setActiveTab(prev => prev === "code" ? "preview" : "code") },
        { id: "toggle-preview", label: "Toggle Preview", category: "View", action: () => setActiveTab("preview") },
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
        
        <div className="h-screen flex flex-col bg-white text-slate-900 selection:bg-violet-200/50 overflow-hidden min-h-0" style={{ fontFamily: "Manrope, ui-sans-serif, system-ui" }}>
            {/* Compact 44px header */}
            <header className="h-11 border-b border-slate-200/70 bg-white/95 backdrop-blur flex items-center justify-between px-4 shrink-0 relative z-40">
                {/* Left: brand + breadcrumb + project name */}
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <DreyvStar size={14} className="text-violet-600" />
                        <span className="text-[12px] font-semibold tracking-tight text-slate-900">dreyv</span>
                    </div>
                    <span className="text-slate-300 text-xs">/</span>
                    <span className="text-[11px] font-medium text-slate-500">Studio</span>
                    <span className="text-slate-300 text-xs">/</span>
                    <Input
                        value={appName}
                        onChange={(e) => setAppName(e.target.value)}
                        className="h-6 w-48 text-[12px] font-medium text-slate-700 bg-transparent border-transparent hover:border-slate-200 focus:border-violet-300 focus:ring-0 px-1.5 rounded transition-colors"
                        placeholder="Untitled mini-app"
                    />
                </div>

                {/* Right: status · wallet · overflow · ship */}
                <div className="flex items-center gap-1.5">
                    {/* Status dot */}
                    <div className="hidden sm:flex items-center gap-1.5 px-2 h-6 rounded-full bg-emerald-50 border border-emerald-200/70">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] font-medium text-emerald-700">Live</span>
                    </div>

                    <button
                        onClick={() => setShowWalletModal(true)}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-medium text-slate-600 bg-slate-50 border border-slate-200/80 hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200 transition-colors"
                        title="Connected wallet / vault keys"
                    >
                        <Shield size={11} className="opacity-70" />
                        <span>{publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : "Connect"}</span>
                    </button>

                    <Avatar className="h-6 w-6 border border-slate-200">
                        <AvatarImage src={getAvatarUrl(user?.info?.name || "operator")} />
                        <AvatarFallback className="text-[9px] font-semibold bg-violet-100 text-violet-700">
                            {user?.info?.name?.charAt(0).toUpperCase() || "U"}
                        </AvatarFallback>
                    </Avatar>

                    <div className="h-4 w-px bg-slate-200 mx-1" />

                    {/* Overflow menu — collapses Save/New/Open/SDK/Test/PDF into one button */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-slate-500 hover:text-violet-700 hover:bg-violet-50 rounded-md"
                                title="More actions"
                            >
                                <MoreHorizontal size={15} />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onClick={handleSave} disabled={isSaving}>
                                <SaveIcon size={13} className="mr-2 text-slate-500" />
                                {isSaving ? "Saving…" : "Save project"}
                                <span className="ml-auto text-[10px] text-slate-400">⌘S</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleNewProject}>
                                <Plus size={13} className="mr-2 text-slate-500" />
                                New from template
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleNewBlankProject}>
                                <FileText size={13} className="mr-2 text-slate-500" />
                                New blank project
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setShowProjectBrowser(true)}>
                                <FolderOpen size={13} className="mr-2 text-slate-500" />
                                Open projects
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setShowSDKReference((p) => !p)}>
                                <BookOpen size={13} className="mr-2 text-slate-500" />
                                SDK reference
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setShowCommandPalette(true)}>
                                <Code2 size={13} className="mr-2 text-slate-500" />
                                Command palette
                                <span className="ml-auto text-[10px] text-slate-400">⌘K</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setShowGlobalSearch(true)}>
                                <Hash size={13} className="mr-2 text-slate-500" />
                                Search files
                                <span className="ml-auto text-[10px] text-slate-400">⌘⇧F</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Single primary CTA */}
                    <StudioToolbar
                        files={files}
                        appName={appName}
                        onShip={handleShip}
                        isShipping={isDeploying}
                    />
                </div>
            </header>

            {/* Main Studio Area — two-pane: Chat (42%) + Workbench (58%) */}
            <div className="flex-1 relative overflow-hidden min-h-0 bg-slate-50/30">
                {/* Plan-stepper overlay (only during plan/build phase, not empty) */}
                {emptyStatePrompt && (
                    <PlanStepper
                        prompt={emptyStatePrompt}
                        onCancel={handleStepperCancel}
                        onBuild={handlePlannerBuild}
                        isBuilding={isPlannerBuilding}
                    />
                )}

                <ResizablePanelGroup direction="horizontal" className="h-full overflow-hidden min-h-0">
                    {/* LEFT — Chat (primary) */}
                    <ResizablePanel defaultSize={42} minSize={28} maxSize={60}>
                        <div className="h-full flex flex-col bg-white border-r border-slate-200/70 overflow-hidden min-h-0">
                            <div className="px-4 h-9 border-b border-slate-200/70 flex items-center justify-between bg-white shrink-0">
                                <div className="flex items-center gap-1.5">
                                    <DreyvStar size={11} className="text-violet-600" />
                                    <span className="text-[11px] font-semibold tracking-tight text-slate-700">AI Architect</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                                    <span className="text-[9px] font-semibold text-violet-600/80 uppercase tracking-wider">Active</span>
                                </div>
                            </div>
                            <div className="flex-1 overflow-hidden min-h-0">
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

                    <ResizableHandle />

                    {/* RIGHT — Workbench (Preview default · Code · Console · Contracts) */}
                    <ResizablePanel defaultSize={58} minSize={40}>
                        <div className="h-full flex flex-col bg-white">
                            {/* Pill tabs row */}
                            <div className="flex items-center justify-between gap-2 px-3 h-9 border-b border-slate-200/70 bg-white shrink-0">
                                <div className="flex items-center gap-0.5 p-0.5 bg-slate-100/70 rounded-md">
                                    {([
                                        { id: "preview", label: "Preview", icon: Eye },
                                        { id: "code", label: "Code", icon: FileCode },
                                        { id: "console", label: "Console", icon: Terminal },
                                        { id: "contract", label: "Contracts", icon: Cpu },
                                    ] as const).map((t) => {
                                        const active = activeTab === (t.id as any);
                                        const Icon = t.icon;
                                        return (
                                            <button
                                                key={t.id}
                                                onClick={() => setActiveTab(t.id as any)}
                                                className={`flex items-center gap-1.5 px-2.5 h-7 text-[11px] font-medium rounded transition-all ${
                                                    active
                                                        ? "bg-white text-violet-700 shadow-sm"
                                                        : "text-slate-500 hover:text-slate-800"
                                                }`}
                                            >
                                                <Icon size={12} strokeWidth={2.2} />
                                                <span>{t.label}</span>
                                                {t.id === "console" && runtimeLogs.length > 0 && (
                                                    <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* File picker — only visible on Code tab */}
                                {activeTab === "code" && (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <button className="flex items-center gap-1.5 px-2.5 h-7 text-[11px] font-medium text-slate-600 hover:text-violet-700 bg-slate-50 hover:bg-violet-50 border border-slate-200 hover:border-violet-200 rounded-md transition-colors">
                                                <FileIcon fileName={activeFile} active />
                                                <span className="font-mono">{activeFile}</span>
                                                <ChevronDown size={11} className="opacity-60" />
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-52">
                                            {Object.keys(files).map((fileName) => (
                                                <DropdownMenuItem
                                                    key={fileName}
                                                    onClick={() => setActiveFile(fileName)}
                                                    className={activeFile === fileName ? "bg-violet-50 text-violet-700" : ""}
                                                >
                                                    <span className="mr-2"><FileIcon fileName={fileName} active={activeFile === fileName} /></span>
                                                    <span className="font-mono text-[11px]">{fileName}</span>
                                                </DropdownMenuItem>
                                            ))}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                )}
                            </div>

                            {/* Active surface */}
                            <div className="flex-1 relative overflow-hidden bg-white">
                                {activeTab === "code" ? (
                                    <CodeEditor
                                        code={files[activeFile]?.content || ""}
                                        language={files[activeFile]?.language || "typescript"}
                                        onChange={handleCodeChange}
                                        fileName={activeFile}
                                        allFiles={files}
                                        isGenerating={isGenerating}
                                        themeName="keystone-light"
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
                                        tab={activeTab === "console" ? "code" : "preview"}
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

            <PremiumModal isOpen={showWalletModal} onClose={() => setShowWalletModal(false)} className="max-w-sm !bg-transparent !border-none !shadow-none !backdrop-blur-none p-0">
                <div className="sr-only">
                    <PremiumModalTitle>Secure Enclave Wallet</PremiumModalTitle>
                    <PremiumModalDescription>Initialize and establish your non-custodial Studio signer.</PremiumModalDescription>
                </div>
                <WalletManager />
            </PremiumModal>


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
