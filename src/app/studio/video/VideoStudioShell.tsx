"use client";

import * as React from "react";
import Link from "next/link";
import {
  Loader2,
  Copy,
  Check,
  ArrowUpRight,
  RefreshCw,
  Video as VideoIcon,
  Wand2,
  Gauge,
  Plug,
  ChevronLeft,
} from "lucide-react";
import StudioPasswordGate from "../StudioPasswordGate";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { studioJsonHeaders, studioAuthHeaders } from "@/lib/media-studio/client-auth";
import { DREYV_DEV_SURFACE } from "@/lib/media-studio/developers-context";

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirror server contracts
// ─────────────────────────────────────────────────────────────────────────────

type Shot = {
  n: number;
  timing: string;
  description: string;
  recommendedTool: string;
  toolPrompt: string;
  mascotInShot: boolean;
};

type Pack = {
  formatLabel: string;
  hook: { textCard: string; spokenLine: string };
  shotList: Shot[];
  voiceoverScript: string;
  burnedCaptions: string[];
  hashtags: string[];
  soundSuggestion: string;
  postingWindow: string;
  mascotNotes: string[];
  whyItWorks: string;
};

type Direction = {
  id: string;
  formatName: string;
  oneLiner: string;
  emotionalCore: string;
  durationSec: number;
  shotCount: number;
  whyItFitsTikTok: string;
  whyItCouldFlop: string;
  targetComment: string;
  exampleOpener: string;
  evidenceRefsUsed: string[];
};

type HookVariant = {
  id: string;
  textCard: string;
  spokenLine: string;
  visualCue: string;
  scrollStop: number;
  concreteness: number;
  watchThrough: number;
  originality: number;
  total: number;
  critique: string;
};

type EvidenceItem = {
  id: string;
  kind: "capability" | "route" | "screenshot" | "wallet" | "metric";
  label: string;
  detail: string;
  pointer?: string;
};

type TikTokDigest = {
  videoCount: number;
  totals: { views: number; likes: number; comments: number; shares: number };
  ratios: { likeRate: number; commentRate: number; shareRate: number; avgWatchThrough: number };
  topVideos: Array<{ videoId: string; caption: string | null; viewCount: number; likeCount: number; fullWatchRate: number | null; shareUrl: string | null }>;
  worstVideos: Array<{ videoId: string; caption: string | null; viewCount: number; likeCount: number; fullWatchRate: number | null; shareUrl: string | null }>;
  narrative: string;
};

type TikTokState = {
  connected: boolean;
  rowCount: number;
  digest: TikTokDigest;
};

type RenderJob = {
  id: string;
  status: "queued" | "rendering_shots" | "stitching" | "done" | "failed";
  model?: string | null;
  shots_total: number;
  shots_done: number;
  shot_urls: string[];
  final_url: string | null;
  duration_sec: number | null;
  error: string | null;
  created_at?: string;
  updated_at?: string;
};

type ProviderId = "veo3-fal" | "veo3-google" | "veo3-vertex" | "wan22-fal";

type Step = "intent" | "direction" | "hook" | "pack";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-semibold text-violet-700 hover:border-violet-400"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function ScorePill({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 8 ? "bg-emerald-100 text-emerald-800" :
    value >= 6 ? "bg-violet-100 text-violet-800" :
    value >= 4 ? "bg-amber-100 text-amber-800" :
    "bg-rose-100 text-rose-800";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
      <span className="opacity-70">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

const PROVIDERS: Array<{ id: ProviderId; label: string; secs: number; usdPerSec: number; note: string }> = [
  { id: "veo3-vertex", label: "Veo 3.1 · Vertex (GCP)", secs: 8, usdPerSec: 0.35, note: "Full multi-shot render · local stitch · no burned text" },
  { id: "veo3-fal", label: "Veo 3 Fast · fal.ai", secs: 8, usdPerSec: 0.40, note: "Best quality · native synced audio" },
  { id: "veo3-google", label: "Veo 3 · Google direct", secs: 8, usdPerSec: 0.35, note: "Uses your GEMINI_API_KEY" },
  { id: "wan22-fal", label: "Wan 2.2 Fast · budget", secs: 5, usdPerSec: 0.05, note: "16× cheaper · no audio" },
];

const STEP_LABELS: Array<{ id: Step; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "intent", label: "Intent", icon: Wand2 },
  { id: "direction", label: "Direction", icon: DreyvStar as unknown as React.ComponentType<{ className?: string }> },
  { id: "hook", label: "Hook foundry", icon: Gauge },
  { id: "pack", label: "Production pack", icon: VideoIcon },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function VideoStudioShell({ unlocked }: { unlocked: boolean }) {
  const [isUnlocked, setIsUnlocked] = React.useState(unlocked);

  // Wizard state
  const [step, setStep] = React.useState<Step>("intent");
  const [intent, setIntent] = React.useState("");
  const [audience, setAudience] = React.useState("");
  const [walletAddress, setWalletAddress] = React.useState("");
  const [primaryTool, setPrimaryTool] = React.useState("");
  const [trendingSound, setTrendingSound] = React.useState("");

  // Intelligence outputs
  const [directions, setDirections] = React.useState<Direction[] | null>(null);
  const [chosenDirection, setChosenDirection] = React.useState<Direction | null>(null);
  const [evidence, setEvidence] = React.useState<EvidenceItem[]>([]);
  const [hooks, setHooks] = React.useState<HookVariant[] | null>(null);
  const [chosenHook, setChosenHook] = React.useState<HookVariant | null>(null);
  const [pack, setPack] = React.useState<Pack | null>(null);

  // TikTok loop
  const [tiktok, setTiktok] = React.useState<TikTokState | null>(null);
  const [tiktokBusy, setTiktokBusy] = React.useState(false);
  const [tiktokError, setTiktokError] = React.useState<string | null>(null);

  // Loading flags
  const [busy, setBusy] = React.useState<null | "directions" | "hooks" | "pack">(null);
  const [error, setError] = React.useState<string | null>(null);

  // Render job
  const [providerId, setProviderId] = React.useState<ProviderId>("veo3-vertex");
  const provider = PROVIDERS.find((p) => p.id === providerId)!;
  const [renderJob, setRenderJob] = React.useState<RenderJob | null>(null);
  const [renderStarting, setRenderStarting] = React.useState(false);
  const [renderError, setRenderError] = React.useState<string | null>(null);
  const [renderStartedAt, setRenderStartedAt] = React.useState<number | null>(null);
  const [renderNow, setRenderNow] = React.useState(Date.now());

  const estimatedRenderSeconds = (pack?.shotList.length ?? 1) * provider.secs;
  const renderModeCopy = providerId === "veo3-vertex"
    ? `Renders all ${pack?.shotList.length ?? 0} sequential Vertex shots, avoids AI-burned text, then stitches locally into one MP4.`
    : `Renders all ${pack?.shotList.length ?? 0} shots, then stitches the final MP4.`;

  // ── Load TikTok state on mount ────────────────────────────────────────
  React.useEffect(() => {
    if (!isUnlocked) return;
    (async () => {
      try {
        const r = await fetch("/api/studio/video/tiktok", { headers: studioAuthHeaders() });
        if (r.ok) setTiktok(await r.json());
      } catch {}
    })();
  }, [isUnlocked]);

  const syncTikTok = React.useCallback(async () => {
    setTiktokBusy(true);
    setTiktokError(null);
    try {
      const r = await fetch("/api/studio/video/tiktok", {
        method: "POST",
        headers: studioJsonHeaders(),
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setTiktok({ connected: true, rowCount: j.digest?.videoCount ?? 0, digest: j.digest });
    } catch (e) {
      setTiktokError(e instanceof Error ? e.message : String(e));
    } finally {
      setTiktokBusy(false);
    }
  }, []);

  // ── Stage transitions ──────────────────────────────────────────────────
  const generateDirections = React.useCallback(async () => {
    setBusy("directions");
    setError(null);
    setDirections(null);
    setChosenDirection(null);
    setHooks(null);
    setChosenHook(null);
    setPack(null);
    try {
      const r = await fetch("/api/studio/video/directions", {
        method: "POST",
        headers: studioJsonHeaders(),
        body: JSON.stringify({
          intent: intent.trim(),
          audience: audience.trim() || undefined,
          walletAddress: walletAddress.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setDirections(j.directions as Direction[]);
      setEvidence((j.evidence as EvidenceItem[]) ?? []);
      setStep("direction");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [intent, audience, walletAddress]);

  const generateHooks = React.useCallback(async (direction: Direction) => {
    setBusy("hooks");
    setError(null);
    setChosenDirection(direction);
    setHooks(null);
    setChosenHook(null);
    setPack(null);
    try {
      const r = await fetch("/api/studio/video/hooks", {
        method: "POST",
        headers: studioJsonHeaders(),
        body: JSON.stringify({
          intent: intent.trim(),
          direction,
          walletAddress: walletAddress.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      const list = j.hooks as HookVariant[];
      setHooks(list);
      // Pre-select top scorer
      if (list.length > 0) setChosenHook(list[0]);
      setStep("hook");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [intent, walletAddress]);

  const generatePack = React.useCallback(async () => {
    if (!chosenDirection || !chosenHook) return;
    setBusy("pack");
    setError(null);
    setPack(null);
    try {
      const r = await fetch("/api/studio/video/draft", {
        method: "POST",
        headers: studioJsonHeaders(),
        body: JSON.stringify({
          intent: intent.trim(),
          direction: chosenDirection,
          hook: chosenHook,
          walletAddress: walletAddress.trim() || undefined,
          primaryTool: primaryTool || undefined,
          trendingSound: trendingSound || undefined,
          audience: audience.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setPack(j as Pack);
      setStep("pack");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [chosenDirection, chosenHook, intent, audience, walletAddress, primaryTool, trendingSound]);

  // ── Render pipeline (unchanged from prior version) ────────────────────
  const submitRender = React.useCallback(async () => {
    if (!pack) return;
    setRenderError(null);
    const res = await fetch("/api/studio/video/render", {
      method: "POST",
      headers: studioJsonHeaders(),
      body: JSON.stringify({ pack, provider: providerId }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
    const nowIso = new Date().toISOString();
    setRenderJob({
      id: j.jobId,
      status: j.warning ? "failed" : "queued",
      shots_total: pack.shotList.length,
      shots_done: 0,
      shot_urls: [],
      final_url: null,
      duration_sec: null,
      error: j.warning ?? null,
      created_at: nowIso,
      updated_at: nowIso,
    });
    setRenderStartedAt(Date.now());
    try { localStorage.setItem("studio.video.activeJobId", j.jobId); } catch {}
  }, [pack, providerId]);

  const startRender = React.useCallback(async () => {
    setRenderStarting(true);
    try { await submitRender(); }
    catch (e) { setRenderError(e instanceof Error ? e.message : String(e)); }
    finally { setRenderStarting(false); }
  }, [submitRender]);

  const startNewRender = React.useCallback(async () => {
    const currentId = renderJob?.id;
    setRenderStarting(true);
    setRenderError(null);
    try {
      if (currentId && renderJob && renderJob.status !== "done" && renderJob.status !== "failed") {
        await fetch(`/api/studio/video/render?id=${currentId}`, { method: "DELETE", headers: studioAuthHeaders() });
      }
      try { localStorage.removeItem("studio.video.activeJobId"); } catch {}
      setRenderJob(null);
      setRenderStartedAt(null);
      await submitRender();
    } catch (e) { setRenderError(e instanceof Error ? e.message : String(e)); }
    finally { setRenderStarting(false); }
  }, [renderJob, submitRender]);

  // Recover active job
  React.useEffect(() => {
    let cancelled = false;
    let stored: string | null = null;
    try { stored = localStorage.getItem("studio.video.activeJobId"); } catch {}
    if (!stored) return;
    (async () => {
      try {
        const r = await fetch(`/api/studio/video/render?id=${stored}`, { headers: studioAuthHeaders() });
        const j = await r.json();
        if (!cancelled && r.ok && j?.id) {
          setRenderJob({
            id: j.id,
            status: j.status,
            model: j.model ?? null,
            shots_total: j.shots_total ?? 0,
            shots_done: j.shots_done ?? 0,
            shot_urls: Array.isArray(j.shot_urls) ? j.shot_urls : [],
            final_url: j.final_url ?? null,
            duration_sec: j.duration_sec ?? null,
            error: j.error ?? null,
            created_at: j.created_at,
            updated_at: j.updated_at,
          });
          setRenderStartedAt(new Date(j.created_at ?? j.updated_at ?? Date.now()).getTime());
        } else if (!cancelled && r.status === 404) {
          try { localStorage.removeItem("studio.video.activeJobId"); } catch {}
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (renderJob && (renderJob.status === "done" || renderJob.status === "failed")) {
      try { localStorage.removeItem("studio.video.activeJobId"); } catch {}
    }
  }, [renderJob?.status]);

  React.useEffect(() => {
    if (!renderJob || renderJob.status === "done" || renderJob.status === "failed") return;
    const handle = setInterval(() => setRenderNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [renderJob?.id, renderJob?.status]);

  React.useEffect(() => {
    if (!renderJob || renderJob.status === "done" || renderJob.status === "failed") return;
    const id = renderJob.id;
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const r = await fetch(`/api/studio/video/render?id=${id}`, { headers: studioAuthHeaders() });
        const j = await r.json();
        if (!cancelled && r.ok) setRenderJob((prev) => (prev && prev.id === id ? { ...prev, ...j } : prev));
      } catch {} finally {
        if (!cancelled) handle = setTimeout(tick, 5000);
      }
    };
    handle = setTimeout(tick, 1000);
    return () => { cancelled = true; if (handle) clearTimeout(handle); };
  }, [renderJob]);

  const elapsedSeconds = renderStartedAt ? Math.max(0, Math.floor((renderNow - renderStartedAt) / 1000)) : 0;
  const elapsedLabel = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  const isVertexRender = providerId === "veo3-vertex" || Boolean(renderJob?.model?.includes("vertex"));
  const hasActiveRender = renderJob !== null && renderJob.status !== "done" && renderJob.status !== "failed";

  if (!isUnlocked) return <StudioPasswordGate onUnlocked={() => setIsUnlocked(true)} />;

  const stepIndex = STEP_LABELS.findIndex((s) => s.id === step);

  // ─────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white font-manrope text-slate-900">
      <header className="sticky top-0 z-20 border-b border-violet-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <VideoIcon className="h-4 w-4 text-violet-700" />
            <span className="text-sm font-semibold">Dreyv Studio · TikTok intelligence</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <Link href="/studio" className="hover:text-violet-700">Media</Link>
            <Link href="/studio/reddit" className="hover:text-violet-700">Reddit</Link>
            <Link href="/studio/case-studies" className="hover:text-violet-700">Case studies</Link>
            <Link href={DREYV_DEV_SURFACE.homepage} className="hover:text-violet-700" target="_blank">
              /developers ↗
            </Link>
          </div>
        </div>
      </header>

      {/* TikTok performance banner — drives the learning loop */}
      <section className="border-b border-violet-100 bg-gradient-to-r from-violet-50/80 to-white">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-violet-600 p-2 text-white">
                <Plug className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">
                  Performance loop {tiktok?.connected ? "· connected" : "· not connected"}
                </div>
                <div className="mt-0.5 text-sm text-slate-700">
                  {tiktok && tiktok.rowCount > 0
                    ? tiktok.digest.narrative
                    : tiktok?.connected
                      ? "TikTok is linked. Click Sync to pull your last 20 videos so every direction + hook is informed by what actually worked."
                      : "Link the TikTok connector so the studio learns from what's actually working on your account. Until then it works blind."}
                </div>
                {tiktokError && (
                  <div className="mt-1 text-xs text-rose-700">{tiktokError}</div>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {tiktok?.connected && (
                <button
                  type="button"
                  onClick={syncTikTok}
                  disabled={tiktokBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:border-violet-400 disabled:opacity-50"
                >
                  {tiktokBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Sync last 20
                </button>
              )}
              {!tiktok?.connected && (
                <span className="text-[11px] text-slate-500">
                  Link TikTok in workspace → Connectors, then refresh.
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Stepper */}
      <section className="border-b border-violet-100 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-6 py-3">
          {STEP_LABELS.map((s, i) => {
            const active = s.id === step;
            const done = i < stepIndex;
            const Icon = s.icon;
            return (
              <React.Fragment key={s.id}>
                <div
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    active
                      ? "border-violet-600 bg-violet-600 text-white"
                      : done
                        ? "border-violet-200 bg-violet-50 text-violet-700"
                        : "border-slate-200 bg-white text-slate-500"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{s.label}</span>
                </div>
                {i < STEP_LABELS.length - 1 && <div className="h-px w-6 bg-slate-200" />}
              </React.Fragment>
            );
          })}
        </div>
      </section>

      {/* Stage content */}
      <section className="mx-auto max-w-7xl px-6 py-8">
        {error && (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* ───────────── STEP 1 — INTENT ───────────── */}
        {step === "intent" && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-3xl border border-violet-100 bg-white p-6">
              <h1 className="text-2xl font-bold tracking-tight">What's this video actually about?</h1>
              <p className="mt-2 text-sm text-slate-600">
                One sentence is enough. The studio will invent three different creative directions for you — no preset formats, no fill-in-the-blank templates.
              </p>

              <label className="mt-5 block">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Intent</span>
                <textarea
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  rows={4}
                  placeholder="e.g. show what happens when an AI agent tries to drain a treasury and dreyv catches it in 200ms"
                  className="mt-1.5 w-full resize-y rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
                />
              </label>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Audience (optional)</span>
                  <input
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    placeholder="solo devs trying MCP, treasury ops on Solana, etc."
                    className="mt-1.5 w-full rounded-2xl border border-violet-200 bg-white px-4 py-2.5 text-sm focus:border-violet-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Real wallet to cite (optional)</span>
                  <input
                    value={walletAddress}
                    onChange={(e) => setWalletAddress(e.target.value)}
                    placeholder="paste a Solana address — opens live evidence"
                    className="mt-1.5 w-full rounded-2xl border border-violet-200 bg-white px-4 py-2.5 text-sm font-mono focus:border-violet-500 focus:outline-none"
                  />
                </label>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Primary tool (optional)</span>
                  <select
                    value={primaryTool}
                    onChange={(e) => setPrimaryTool(e.target.value)}
                    className="mt-1.5 w-full rounded-2xl border border-violet-200 bg-white px-4 py-2.5 text-sm focus:border-violet-500 focus:outline-none"
                  >
                    <option value="">Let the model pick</option>
                    <option value="hedra">Hedra (mascot lip-sync)</option>
                    <option value="hailuo">Hailuo / MiniMax ($7.99/mo)</option>
                    <option value="kling">Kling 3.0</option>
                    <option value="veo3-fast">Veo 3 Fast ($0.15/sec)</option>
                    <option value="wan22">Wan 2.2 (self-hosted free)</option>
                    <option value="runway-gen4">Runway Gen-4 Reference</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Trending sound (optional)</span>
                  <input
                    value={trendingSound}
                    onChange={(e) => setTrendingSound(e.target.value)}
                    placeholder="e.g. suspense-rising-into-reveal loop"
                    className="mt-1.5 w-full rounded-2xl border border-violet-200 bg-white px-4 py-2.5 text-sm focus:border-violet-500 focus:outline-none"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={generateDirections}
                disabled={busy !== null || intent.trim().length < 4}
                className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {busy === "directions" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {busy === "directions" ? "Inventing 3 directions…" : "Generate 3 directions"}
              </button>
            </div>

            <aside className="rounded-3xl border border-violet-200 bg-white p-6 shadow-[0_30px_60px_-40px_rgba(124,58,237,0.45)]">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">How this differs</div>
              <div className="mt-1 text-base font-semibold text-slate-900">Intelligent, not template-driven</div>
              <ul className="mt-4 space-y-3 text-[13px] leading-relaxed text-slate-700">
                {[
                  ["Direction Generator", "Invents 3 fresh formats for your intent — no POV / TIL / skit dropdown."],
                  ["Hook Foundry", "Generates 10 hooks and an internal critic scores each on scroll-stop, concreteness, watch-through, and originality."],
                  ["Evidence-grounded", "Every factual claim must map to a real capability, route, screenshot, or wallet — no invented metrics."],
                  ["Learns from your account", tiktok && tiktok.rowCount > 0
                    ? `Last ${tiktok.rowCount} TikToks are feeding the planner.`
                    : "Connect TikTok to feed the planner with what's actually working."],
                ].map(([k, v]) => (
                  <li key={k} className="flex items-start gap-2">
                    <DreyvStar className="mt-[3px] h-2.5 w-2.5 shrink-0 text-violet-600" />
                    <span>
                      <strong className="font-semibold text-slate-900">{k}.</strong> {v}
                    </span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        )}

        {/* ───────────── STEP 2 — DIRECTION ───────────── */}
        {step === "direction" && directions && (
          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep("intent")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900"
              >
                <ChevronLeft className="h-3 w-3" /> Back to intent
              </button>
              <button
                type="button"
                onClick={generateDirections}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:border-violet-400 disabled:opacity-50"
              >
                {busy === "directions" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Reroll directions
              </button>
            </div>
            <h2 className="text-2xl font-bold tracking-tight">Pick a direction</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Each is genuinely different in shape — length, energy, voice. The studio will not let you carry forward without a chosen direction.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
              {directions.map((d) => {
                const active = chosenDirection?.id === d.id;
                return (
                  <div
                    key={d.id}
                    className={`flex h-full flex-col rounded-3xl border bg-white p-5 transition ${
                      active ? "border-violet-600 ring-2 ring-violet-200" : "border-violet-100 hover:border-violet-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-violet-700">
                        {d.durationSec}s · {d.shotCount} shots
                      </div>
                      {active && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-600 px-2.5 py-0.5 text-[10px] font-semibold text-white">
                          <Check className="h-3 w-3" /> chosen
                        </span>
                      )}
                    </div>
                    <h3 className="mt-3 text-lg font-bold leading-tight text-slate-900">{d.formatName}</h3>
                    <p className="mt-1 text-sm text-slate-700">{d.oneLiner}</p>

                    <div className="mt-4 space-y-3 text-[13px] leading-relaxed text-slate-700">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">Emotional core</div>
                        <div className="mt-0.5">{d.emotionalCore}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">Example opener</div>
                        <div className="mt-0.5 italic">“{d.exampleOpener}”</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">Why it could land</div>
                        <div className="mt-0.5">{d.whyItFitsTikTok}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-widest text-rose-700">Risk</div>
                        <div className="mt-0.5 text-slate-600">{d.whyItCouldFlop}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">Target comment</div>
                        <div className="mt-0.5 text-slate-600">“{d.targetComment}”</div>
                      </div>
                      {d.evidenceRefsUsed.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">Evidence used</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {d.evidenceRefsUsed.map((id) => {
                              const ev = evidence.find((e) => e.id === id);
                              return (
                                <span key={id} className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                                  {ev?.label ?? id}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-auto pt-5">
                      <button
                        type="button"
                        onClick={() => generateHooks(d)}
                        disabled={busy !== null}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                      >
                        {busy === "hooks" && active ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                        Use this direction
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ───────────── STEP 3 — HOOK FOUNDRY ───────────── */}
        {step === "hook" && hooks && chosenDirection && (
          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep("direction")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900"
              >
                <ChevronLeft className="h-3 w-3" /> Back to directions
              </button>
              <button
                type="button"
                onClick={() => generateHooks(chosenDirection)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:border-violet-400 disabled:opacity-50"
              >
                {busy === "hooks" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Reroll 10 hooks
              </button>
            </div>

            <div className="rounded-3xl border border-violet-100 bg-violet-50/40 p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">Chosen direction</div>
              <div className="mt-1 text-base font-bold text-slate-900">{chosenDirection.formatName}</div>
              <div className="text-sm text-slate-700">{chosenDirection.oneLiner}</div>
            </div>

            <h2 className="mt-6 text-2xl font-bold tracking-tight">Hook foundry · 10 variants, critic-scored</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Scores are 0–10 each. The critic was told to score harshly — most hooks land in 3–6, only 1–2 should hit 8+. Top scorer is pre-selected.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {hooks.map((h, i) => {
                const active = chosenHook?.id === h.id;
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setChosenHook(h)}
                    className={`flex flex-col gap-3 rounded-3xl border bg-white p-5 text-left transition ${
                      active ? "border-violet-600 ring-2 ring-violet-200" : "border-violet-100 hover:border-violet-300"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-mono text-white">#{i + 1}</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-600 px-2.5 py-0.5 text-xs font-bold text-white">
                          <Gauge className="h-3 w-3" /> {h.total.toFixed(1)}
                        </span>
                        {active && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                            <Check className="h-3 w-3" /> selected
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <ScorePill label="stop" value={h.scrollStop} />
                        <ScorePill label="concrete" value={h.concreteness} />
                        <ScorePill label="watch" value={h.watchThrough} />
                        <ScorePill label="orig" value={h.originality} />
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">Text card (1.5s)</div>
                      <div className="mt-0.5 text-base font-bold text-slate-900">{h.textCard}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">Spoken opener</div>
                      <div className="mt-0.5 text-sm text-slate-800">{h.spokenLine}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">Visual cue</div>
                      <div className="mt-0.5 text-sm text-slate-700">{h.visualCue}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600">
                      <span className="font-semibold text-slate-800">Critic:</span> {h.critique}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-violet-200 bg-white p-5">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Locked hook</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-900">
                  {chosenHook ? `“${chosenHook.textCard}” → “${chosenHook.spokenLine}”` : "Pick a hook above."}
                </div>
              </div>
              <button
                type="button"
                onClick={generatePack}
                disabled={busy !== null || !chosenHook}
                className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {busy === "pack" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                {busy === "pack" ? "Building grounded pack…" : "Build production pack"}
              </button>
            </div>
          </div>
        )}

        {/* ───────────── STEP 4 — PACK + RENDER ───────────── */}
        {step === "pack" && pack && (
          <>
            <div className="mb-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep("hook")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900"
              >
                <ChevronLeft className="h-3 w-3" /> Back to hooks
              </button>
              <button
                type="button"
                onClick={generatePack}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:border-violet-400 disabled:opacity-50"
              >
                {busy === "pack" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Rebuild pack
              </button>
            </div>

            <div className="mb-6 flex items-baseline justify-between gap-4">
              <h2 className="text-2xl font-bold tracking-tight">{pack.formatLabel}</h2>
              <span className="text-xs text-slate-500">{pack.whyItWorks}</span>
            </div>

            {/* RENDER BAR */}
            <div className="mb-6 rounded-3xl border border-violet-200 bg-violet-50/60 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">
                    Auto-render · {provider.label}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    {renderModeCopy}{' '}~${(estimatedRenderSeconds * provider.usdPerSec).toFixed(2)} estimated cost. {provider.note}.
                  </div>
                  <div className="mt-3 inline-flex flex-wrap gap-1.5 rounded-2xl border border-violet-200 bg-white p-1">
                    {PROVIDERS.map((p) => {
                      const active = p.id === providerId;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setProviderId(p.id)}
                          disabled={renderStarting || hasActiveRender}
                          className={
                            "rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 " +
                            (active ? "bg-violet-600 text-white" : "text-slate-700 hover:bg-violet-50")
                          }
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[210px]">
                  <button
                    type="button"
                    onClick={startRender}
                    disabled={renderStarting || hasActiveRender}
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/20 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {renderStarting ? "Submitting…" : hasActiveRender ? "Rendering…" : renderJob?.status === "done" ? "Re-render full ad" : "Render full ad"}
                  </button>
                  {hasActiveRender && (
                    <button
                      type="button"
                      onClick={startNewRender}
                      disabled={renderStarting}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-violet-200 bg-white px-4 py-2.5 text-sm font-semibold text-violet-700 transition hover:border-violet-400 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Start new render
                    </button>
                  )}
                </div>
              </div>

              {renderError && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {renderError}
                </div>
              )}

              {renderJob && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-white">{renderJob.status}</span>
                    {renderJob.status !== "done" && renderJob.status !== "failed" && (
                      <span className="text-slate-600">
                        {isVertexRender
                          ? `${renderJob.shots_done}/${renderJob.shots_total} Vertex shots rendered · ${elapsedLabel}`
                          : `${renderJob.shots_done}/${renderJob.shots_total} shots rendered · ${elapsedLabel}`}
                      </span>
                    )}
                    <Link
                      href={`/studio/video/${renderJob.id}/progress`}
                      className="ml-auto inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white px-2.5 py-0.5 font-semibold text-violet-700 hover:border-violet-400"
                    >
                      Open progress view <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-violet-600 transition-all"
                      style={{
                        width: renderJob.status === "done"
                          ? "100%"
                          : renderJob.status === "stitching"
                            ? "92%"
                            : `${(renderJob.shots_done / Math.max(1, renderJob.shots_total)) * (isVertexRender ? 82 : 85)}%`,
                      }}
                    />
                  </div>
                  {renderJob.error && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{renderJob.error}</div>
                  )}
                  {renderJob.shot_urls && renderJob.shot_urls.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                      {renderJob.shot_urls.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-violet-100 bg-black">
                          <video src={u} className="aspect-[9/16] w-full object-cover" muted playsInline />
                          <div className="px-2 py-1 text-[10px] text-slate-500">Shot {i + 1}</div>
                        </a>
                      ))}
                    </div>
                  )}
                  {renderJob.final_url && (
                    <div className="rounded-2xl border border-violet-200 bg-white p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Final ad · {renderJob.duration_sec}s</div>
                        <a href={renderJob.final_url} download className="text-xs font-semibold text-violet-700 underline-offset-2 hover:underline">Download MP4 ↓</a>
                      </div>
                      <video src={renderJob.final_url} className="aspect-[9/16] w-full max-w-xs rounded-xl bg-black" controls playsInline />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* PACK GRID */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
              <div className="space-y-6">
                <div className="rounded-3xl border border-violet-100 bg-white p-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-widest text-violet-700">Hook (first 1.5s)</h3>
                    <CopyButton text={`${pack.hook.textCard}\n\n${pack.hook.spokenLine}`} />
                  </div>
                  <div className="rounded-2xl bg-violet-50 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Text card</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{pack.hook.textCard}</div>
                  </div>
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Spoken opener</div>
                    <div className="mt-1 text-sm text-slate-800">{pack.hook.spokenLine}</div>
                  </div>
                </div>

                <div className="rounded-3xl border border-violet-100 bg-white p-6">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-violet-700">Shot list & per-tool prompts</h3>
                  <ol className="space-y-4">
                    {pack.shotList.map((shot) => (
                      <li key={shot.n} className="rounded-2xl border border-slate-200 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded-full bg-violet-600 px-2 py-0.5 font-semibold text-white">Shot {shot.n}</span>
                            <span className="font-mono text-slate-500">{shot.timing}</span>
                            <span className="rounded-full border border-violet-200 px-2 py-0.5 font-semibold text-violet-700">{shot.recommendedTool}</span>
                            {shot.mascotInShot && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Mascot in shot</span>
                            )}
                          </div>
                        </div>
                        <p className="mt-2 text-sm text-slate-800">{shot.description}</p>
                        <div className="mt-3 rounded-xl bg-slate-900 p-3">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Paste into {shot.recommendedTool}</span>
                            <CopyButton text={shot.toolPrompt} />
                          </div>
                          <pre className="whitespace-pre-wrap font-mono text-xs leading-5 text-slate-100">{shot.toolPrompt}</pre>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="rounded-3xl border border-violet-100 bg-white p-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-widest text-violet-700">Voiceover script (ElevenLabs → Hedra)</h3>
                    <CopyButton text={pack.voiceoverScript} />
                  </div>
                  <pre className="whitespace-pre-wrap font-manrope text-sm leading-6 text-slate-800">{pack.voiceoverScript}</pre>
                </div>

                <div className="rounded-3xl border border-violet-100 bg-white p-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-widest text-violet-700">Burned captions (CapCut)</h3>
                    <CopyButton text={pack.burnedCaptions.join("\n")} />
                  </div>
                  <ol className="space-y-1.5 text-sm text-slate-800">
                    {pack.burnedCaptions.map((c, i) => (
                      <li key={i} className="rounded-lg bg-slate-50 px-3 py-2"><span className="mr-2 text-slate-400">{i + 1}.</span>{c}</li>
                    ))}
                  </ol>
                </div>
              </div>

              <aside className="space-y-6">
                <div className="rounded-3xl border border-violet-100 bg-violet-50/60 p-6">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-violet-700">Posting window</h3>
                  <p className="mt-2 text-sm text-slate-800">{pack.postingWindow}</p>
                </div>
                <div className="rounded-3xl border border-violet-100 bg-white p-6">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-violet-700">Sound</h3>
                  <p className="mt-2 text-sm text-slate-800">{pack.soundSuggestion}</p>
                </div>
                <div className="rounded-3xl border border-violet-100 bg-white p-6">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-widest text-violet-700">Hashtags</h3>
                    <CopyButton text={pack.hashtags.join(" ")} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {pack.hashtags.map((h, i) => (
                      <span key={i} className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700">{h}</span>
                    ))}
                  </div>
                </div>
                <div className="rounded-3xl border border-violet-100 bg-white p-6">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-violet-700">Mascot consistency notes</h3>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    {pack.mascotNotes.map((n, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <DreyvStar size={10} />
                        <span>{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </aside>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
