"use client";

import * as React from "react";
import {
  FileText,
  Layout,
  Megaphone,
  Video,
  Loader2,
  Image as ImageIcon,
  RefreshCw,
  Library as LibraryIcon,
  ChevronDown,
  Check,
} from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import type {
  AssetKind,
  Channel,
  ContentSuggestion,
  CopyResult,
  InfographicSpec,
  VideoStoryboard,
} from "@/lib/media-studio/types";
import { CopyVariantCard } from "@/components/media-studio/CopyVariantCard";
import { InfographicCanvas } from "@/components/media-studio/InfographicCanvas";
import { StoryboardCanvas } from "@/components/media-studio/StoryboardCanvas";
import { AssetLibrary } from "@/components/media-studio/AssetLibrary";
import { ImageActions, ImageLightbox, safeFilename } from "@/components/media-studio/ImageViewer";
import { studioAuthHeaders, studioJsonHeaders } from "@/lib/media-studio/client-auth";

/**
 * Safely parse a fetch Response that we expect to be JSON. Production edges
 * (Vercel timeouts, gateway errors, HTML error pages) can return empty or
 * non-JSON bodies — surface a real, actionable message instead of the cryptic
 * "Unexpected end of JSON input".
 */
async function readJsonSafe(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) {
    throw new Error(
      res.ok
        ? "The server returned an empty response. Please try again."
        : `Request failed (${res.status} ${res.statusText || "no response body"}). The generation may have timed out — try a shorter prompt or retry.`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 160).replace(/\s+/g, " ").trim();
    throw new Error(
      `Unexpected response from server (${res.status}): ${snippet || "non-JSON body"}`,
    );
  }
}

type Mode = AssetKind;
type Aspect = "1:1" | "16:9" | "9:16" | "4:5";

type StudioJob = ContentSuggestion & {
  aspect: Aspect;
  durationSeconds: number;
};

const MODES: Array<{ id: Mode; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }> = [
  { id: "post", label: "Post", icon: FileText, hint: "Copy + image" },
  { id: "infographic", label: "Infographic", icon: Layout, hint: "Brand card" },
  { id: "announcement", label: "Announcement", icon: Megaphone, hint: "Launch visual" },
  { id: "video", label: "Video", icon: Video, hint: "Storyboard" },
];

const CHANNELS: Channel[] = ["x", "linkedin", "instagram", "generic"];
const ASPECTS_BY_MODE: Record<Mode, Aspect[]> = {
  post: ["1:1", "4:5", "16:9"],
  infographic: ["1:1", "4:5", "16:9"],
  announcement: ["16:9", "1:1", "4:5"],
  video: ["9:16", "1:1", "16:9"],
};
const DURATIONS = [10, 15, 30] as const;

const FALLBACK_JOBS: StudioJob[] = [
  {
    id: "runway-drift",
    kind: "post",
    channel: "x",
    title: "Runway drift is silent until it is not",
    brief:
      "Write a sharp X post for crypto-native founders about treasury drift: stablecoin runway changes, token volatility, and why Dreyv turns drift into a directive before it becomes a meeting.",
    audience: "crypto founders",
    aspect: "1:1",
    durationSeconds: 15,
  },
  {
    id: "foresight-loop",
    kind: "infographic",
    channel: "linkedin",
    title: "From balance sheet to next move",
    brief:
      "Create an infographic showing Dreyv's treasury operating loop: observe balances, detect drift, forecast runway, propose a directive, execute through multisig. Do not invent metrics.",
    audience: "DAO operators",
    aspect: "4:5",
    durationSeconds: 15,
  },
  {
    id: "atlas-front-door",
    kind: "announcement",
    channel: "linkedin",
    title: "Atlas as the read-only front door",
    brief:
      "Draft a launch-style announcement for Atlas: a read-only Solana treasury intelligence surface for comparing tokens, routes, and risk before connecting a wallet.",
    audience: "Solana teams",
    aspect: "16:9",
    durationSeconds: 15,
  },
  {
    id: "one-calm-command",
    kind: "video",
    channel: "x",
    title: "One calm command",
    brief:
      "Storyboard a short motion post showing a founder moving from spreadsheet anxiety to one Dreyv command that explains runway, drift, and the next treasury directive.",
    audience: "founder-operators",
    aspect: "9:16",
    durationSeconds: 15,
  },
];

function normalizeJob(suggestion: ContentSuggestion): StudioJob {
  return {
    ...suggestion,
    aspect: (suggestion.aspect ?? (suggestion.kind === "video" ? "9:16" : "1:1")) as Aspect,
    durationSeconds: suggestion.durationSeconds ?? 15,
  };
}

export default function MediaStudioClient() {
  const [jobs, setJobs] = React.useState<StudioJob[]>(FALLBACK_JOBS);
  const [selectedId, setSelectedId] = React.useState(FALLBACK_JOBS[0].id);
  const [mode, setMode] = React.useState<Mode>(FALLBACK_JOBS[0].kind);
  const [channel, setChannel] = React.useState<Channel>(FALLBACK_JOBS[0].channel);
  const [aspect, setAspect] = React.useState<Aspect>(FALLBACK_JOBS[0].aspect);
  const [duration, setDuration] = React.useState<number>(FALLBACK_JOBS[0].durationSeconds);

  const [busy, setBusy] = React.useState<null | "suggestions" | "copy" | "image" | "infographic" | "video">(null);
  const [copyResult, setCopyResult] = React.useState<CopyResult | null>(null);
  const [infographic, setInfographic] = React.useState<InfographicSpec | null>(null);
  const [storyboard, setStoryboard] = React.useState<VideoStoryboard | null>(null);
  const [imagePreview, setImagePreview] = React.useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [briefOpen, setBriefOpen] = React.useState(false);
  const [tab, setTab] = React.useState<"output" | "library">("output");
  const autoStartedRef = React.useRef(false);

  const selectedJob = React.useMemo(
    () => jobs.find((job) => job.id === selectedId) ?? jobs[0] ?? FALLBACK_JOBS[0],
    [jobs, selectedId],
  );

  const resetOutput = React.useCallback(() => {
    setCopyResult(null);
    setInfographic(null);
    setStoryboard(null);
    setImagePreview(null);
    setError(null);
  }, []);

  const applyJob = React.useCallback(
    (job: StudioJob) => {
      setSelectedId(job.id);
      setMode(job.kind);
      setChannel(job.channel);
      setAspect(job.aspect);
      setDuration(job.durationSeconds);
      resetOutput();
    },
    [resetOutput],
  );

  const generateFor = React.useCallback(
    async (job: StudioJob, overrides?: { channel?: Channel; aspect?: Aspect; duration?: number }) => {
      setError(null);
      setNotice(null);
      const effChannel = overrides?.channel ?? job.channel;
      const effAspect = overrides?.aspect ?? job.aspect;
      const effDuration = overrides?.duration ?? job.durationSeconds;
      try {
        if (job.kind === "post" || job.kind === "announcement") {
          setBusy("copy");
          setCopyResult(null);
          const res = await fetch("/api/studio/media/generate-copy", {
            method: "POST",
            headers: studioJsonHeaders(),
            body: JSON.stringify({ kind: job.kind, channel: effChannel, prompt: job.brief, audience: job.audience }),
          });
          const json = await readJsonSafe(res);
          if (!res.ok) throw new Error(json.error ?? "Copy generation failed");
          setCopyResult(json);
        } else if (job.kind === "infographic") {
          setBusy("infographic");
          setInfographic(null);
          setImagePreview(null);
          const res = await fetch("/api/studio/media/generate-infographic", {
            method: "POST",
            headers: studioJsonHeaders(),
            body: JSON.stringify({
              prompt: job.brief,
              channel: effChannel,
              aspect: effAspect,
              title: job.title,
            }),
          });
          const json = await readJsonSafe(res);
          if (!res.ok) throw new Error(json.error ?? "Infographic generation failed");
          if (json.previewUrl) setImagePreview(json.previewUrl);
          if (json.error) setNotice(json.error);
          setRefreshKey((k) => k + 1);
        } else {
          setBusy("video");
          setStoryboard(null);
          const res = await fetch("/api/studio/media/generate-video", {
            method: "POST",
            headers: studioJsonHeaders(),
            body: JSON.stringify({
              prompt: job.brief,
              durationSeconds: effDuration,
              aspect: effAspect === "9:16" ? "9:16" : "1:1",
            }),
          });
          const json = await readJsonSafe(res);
          if (!res.ok) throw new Error(json.error ?? "Video generation failed");
          setStoryboard(json.spec);
          setRefreshKey((k) => k + 1);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const loadSuggestions = React.useCallback(
    async ({ autoRun }: { autoRun: boolean }) => {
      setBusy("suggestions");
      setError(null);
      try {
        const res = await fetch("/api/studio/media/suggestions", { headers: studioAuthHeaders() });
        const json = await readJsonSafe(res);
        const nextJobs = ((json.suggestions as ContentSuggestion[] | undefined) ?? FALLBACK_JOBS).map(normalizeJob);
        setJobs(nextJobs);
        const first = nextJobs[0] ?? FALLBACK_JOBS[0];
        applyJob(first);
        if (json.fallback || !res.ok) setNotice(json.error ?? "Using prepared Dreyv suggestions for now.");
        if (autoRun) await generateFor(first);
      } catch (e) {
        setJobs(FALLBACK_JOBS);
        applyJob(FALLBACK_JOBS[0]);
        setNotice(e instanceof Error ? e.message : "Using prepared Dreyv suggestions for now.");
        if (autoRun) await generateFor(FALLBACK_JOBS[0]);
      } finally {
        setBusy(null);
      }
    },
    [applyJob, generateFor],
  );

  React.useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    void loadSuggestions({ autoRun: true });
  }, [loadSuggestions]);

  async function generateImage() {
    setError(null);
    setBusy("image");
    setImagePreview(null);
    try {
      const res = await fetch("/api/studio/media/generate-image", {
        method: "POST",
        headers: studioJsonHeaders(),
        body: JSON.stringify({ prompt: selectedJob.brief, kind: mode, channel, aspect, title: selectedJob.title }),
      });
      const json = await readJsonSafe(res);
      if (!res.ok) throw new Error(json.error ?? "Image generation failed");
      setImagePreview(json.previewUrl);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image generation failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveCopy(variant: { headline?: string; body: string; cta?: string }) {
    await fetch("/api/studio/media/assets", {
      method: "POST",
      headers: studioJsonHeaders(),
      body: JSON.stringify({
        kind: mode,
        channel,
        title: variant.headline ?? variant.body.slice(0, 80),
        prompt: selectedJob.brief,
        spec: { variant, altText: copyResult?.altText, hashtags: copyResult?.suggestedHashtags },
      }),
    });
    setRefreshKey((k) => k + 1);
  }

  async function saveInfographic() {
    if (!infographic) return;
    await fetch("/api/studio/media/assets", {
      method: "POST",
      headers: studioJsonHeaders(),
      body: JSON.stringify({ kind: "infographic", title: infographic.title, prompt: selectedJob.brief, spec: infographic }),
    });
    setRefreshKey((k) => k + 1);
  }

  const isGenerating = busy === "copy" || busy === "infographic" || busy === "video";
  const hasOutput = !!(copyResult || infographic || storyboard || imagePreview);
  const aspects = ASPECTS_BY_MODE[mode];

  return (
    <>
    <div className="relative min-h-screen w-full overflow-hidden bg-studio-bg font-manrope text-studio-fg">
      {/* Ambient violet glows */}
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-violet-300/30 blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 right-0 h-[420px] w-[600px] rounded-full bg-violet-400/20 blur-[120px]" />

      <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-10">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-studio-violet">
              <DreyvStar size={14} />
              Dreyv · Media Studio
            </div>
            <h1 className="mt-2 max-w-2xl text-3xl font-bold leading-[1.05] tracking-tight sm:text-4xl lg:text-5xl">
              Ready content, on brand by default.
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-studio-muted">
              The studio proposes briefs and starts the first generation automatically. Tune channel, aspect, or regenerate any time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-studio-border bg-white/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-studio-violet backdrop-blur">
              Private · Team only
            </span>
          </div>
        </header>

        {/* Mode tabs */}
        <div className="mt-6 grid grid-cols-2 gap-1.5 rounded-2xl border border-studio-border bg-white/80 p-1.5 backdrop-blur sm:grid-cols-4">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => {
                  const next = jobs.find((job) => job.kind === m.id) ?? selectedJob;
                  applyJob(next);
                }}
                className={
                  "flex min-h-16 flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left transition " +
                  (active
                    ? "bg-studio-violet text-primary-foreground shadow-[0_8px_24px_-8px_rgba(124,58,237,0.5)]"
                    : "text-studio-fg hover:bg-studio-violet-soft")
                }
              >
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                </div>
                <span className={"text-[10px] " + (active ? "text-primary-foreground/80" : "text-studio-muted")}>
                  {m.hint}
                </span>
              </button>
            );
          })}
        </div>

        {/* Mobile collapsible brief */}
        <div className="mt-4 lg:hidden">
          <button
            onClick={() => setBriefOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-2xl border border-studio-border bg-white/80 px-4 py-3 text-left backdrop-blur"
          >
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-studio-violet">Selected brief</div>
              <div className="mt-0.5 truncate text-sm font-bold">{selectedJob.title}</div>
            </div>
            <ChevronDown className={"h-4 w-4 shrink-0 text-studio-muted transition " + (briefOpen ? "rotate-180" : "")} />
          </button>
        </div>

        {/* Main layout */}
        <div className="mt-4 grid grid-cols-1 gap-5 lg:mt-6 lg:grid-cols-[400px_1fr] lg:gap-6">
          {/* LEFT: Directions + brief */}
          <aside className={"space-y-4 " + (briefOpen ? "" : "hidden lg:block")}>
            <section className="rounded-3xl border border-studio-border bg-white/85 p-4 backdrop-blur sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-studio-violet">
                    Generated directions
                  </div>
                  <h2 className="mt-1 text-lg font-bold tracking-tight sm:text-xl">Pick one to start.</h2>
                </div>
                <button
                  onClick={() => loadSuggestions({ autoRun: false })}
                  disabled={busy !== null}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-studio-border bg-white text-studio-violet hover:bg-studio-violet-soft disabled:opacity-50"
                  aria-label="Refresh suggestions"
                >
                  {busy === "suggestions" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </button>
              </div>

              {busy === "suggestions" && jobs.length === 0 ? (
                <div className="mt-4 space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-16 animate-pulse rounded-2xl bg-studio-violet-soft" />
                  ))}
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {jobs.map((job) => {
                    const active = selectedJob.id === job.id;
                    return (
                      <button
                        key={job.id}
                        onClick={() => applyJob(job)}
                        className={
                          "group w-full rounded-2xl border p-3 text-left transition " +
                          (active
                            ? "border-studio-violet bg-studio-violet-soft"
                            : "border-studio-border bg-white hover:border-studio-violet/40 hover:bg-studio-violet-soft")
                        }
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="line-clamp-1 text-sm font-bold tracking-tight">{job.title}</span>
                          <span className="shrink-0 rounded-full bg-studio-violet/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-studio-violet">
                            {job.kind}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-studio-muted">{job.brief}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-studio-border bg-white/85 p-4 backdrop-blur sm:p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-studio-violet">Selected brief</div>
              <h3 className="mt-1.5 text-base font-bold tracking-tight sm:text-lg">{selectedJob.title}</h3>
              <p className="mt-2 text-sm leading-6 text-studio-muted">{selectedJob.brief}</p>

              {/* Channel chips */}
              <div className="mt-4">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-studio-muted">Channel</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {CHANNELS.map((c) => {
                    const active = channel === c;
                    return (
                      <button
                        key={c}
                        onClick={() => setChannel(c)}
                        className={
                          "rounded-full border px-3 py-1 text-xs font-semibold capitalize transition " +
                          (active
                            ? "border-studio-violet bg-studio-violet text-primary-foreground"
                            : "border-studio-border bg-white text-studio-fg hover:bg-studio-violet-soft")
                        }
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Aspect chips */}
              <div className="mt-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-studio-muted">Aspect</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {aspects.map((a) => {
                    const active = aspect === a;
                    return (
                      <button
                        key={a}
                        onClick={() => setAspect(a)}
                        className={
                          "rounded-full border px-3 py-1 text-xs font-mono font-semibold transition " +
                          (active
                            ? "border-studio-violet bg-studio-violet text-primary-foreground"
                            : "border-studio-border bg-white text-studio-fg hover:bg-studio-violet-soft")
                        }
                      >
                        {a}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Duration (video only) */}
              {mode === "video" && (
                <div className="mt-3">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-studio-muted">Duration</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {DURATIONS.map((d) => {
                      const active = duration === d;
                      return (
                        <button
                          key={d}
                          onClick={() => setDuration(d)}
                          className={
                            "rounded-full border px-3 py-1 text-xs font-semibold transition " +
                            (active
                              ? "border-studio-violet bg-studio-violet text-primary-foreground"
                              : "border-studio-border bg-white text-studio-fg hover:bg-studio-violet-soft")
                          }
                        >
                          {d}s
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="mt-5 flex flex-col gap-2">
                <button
                  onClick={() => generateFor(selectedJob, { channel, aspect, duration })}
                  disabled={busy !== null}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-studio-violet px-4 py-3 text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_-10px_rgba(124,58,237,0.55)] transition hover:opacity-95 disabled:opacity-50"
                >
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <DreyvStar size={14} />}
                  {hasOutput ? "Regenerate" : "Generate this direction"}
                </button>
                {(mode === "post" || mode === "announcement") && (
                  <button
                    onClick={generateImage}
                    disabled={busy !== null}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-studio-border bg-white px-4 py-3 text-sm font-semibold text-studio-violet hover:bg-studio-violet-soft disabled:opacity-50"
                  >
                    {busy === "image" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ImageIcon className="h-4 w-4" />
                    )}
                    Generate matching image
                  </button>
                )}
              </div>

              {notice && (
                <div className="mt-4 rounded-2xl border border-studio-border bg-studio-violet-soft p-3 text-xs leading-5 text-studio-muted">
                  {notice}
                </div>
              )}
              {error && (
                <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs leading-5 text-destructive">
                  {error}
                </div>
              )}
            </section>
          </aside>

          {/* RIGHT: Output canvas */}
          <main className="min-w-0 space-y-4">
            {/* Output / Library tabs */}
            <div className="flex items-center gap-1.5 rounded-full border border-studio-border bg-white/80 p-1 backdrop-blur w-fit">
              <button
                onClick={() => setTab("output")}
                className={
                  "rounded-full px-4 py-1.5 text-xs font-semibold transition " +
                  (tab === "output" ? "bg-studio-violet text-primary-foreground" : "text-studio-muted hover:text-studio-fg")
                }
              >
                Output
              </button>
              <button
                onClick={() => setTab("library")}
                className={
                  "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition " +
                  (tab === "library" ? "bg-studio-violet text-primary-foreground" : "text-studio-muted hover:text-studio-fg")
                }
              >
                <LibraryIcon className="h-3 w-3" /> Library
              </button>
            </div>

            {tab === "output" ? (
              <div className="space-y-4">
                {/* Loading skeleton */}
                {isGenerating && !hasOutput && <OutputSkeleton mode={mode} />}

                {/* Copy variants */}
                {(mode === "post" || mode === "announcement") && copyResult && (
                  <div className="space-y-3">
                    {copyResult.variants.map((v, i) => (
                      <CopyVariantCard
                        key={i}
                        index={i + 1}
                        headline={v.headline}
                        body={v.body}
                        cta={v.cta}
                        onSave={() => saveCopy(v)}
                      />
                    ))}
                    {(copyResult.suggestedHashtags?.length || 0) > 0 && (
                      <div className="rounded-2xl border border-studio-border bg-white p-3 text-xs leading-6 text-studio-muted">
                        <span className="font-semibold text-studio-violet">Hashtags:</span>{" "}
                        {copyResult.suggestedHashtags.map((h) => `#${h}`).join("  ")}
                      </div>
                    )}
                    {copyResult.altText && (
                      <div className="rounded-2xl border border-studio-border bg-white p-3 text-xs leading-6 text-studio-muted">
                        <span className="font-semibold text-studio-violet">Alt text:</span> {copyResult.altText}
                      </div>
                    )}
                  </div>
                )}

                {/* Image preview */}
                {imagePreview && (mode === "post" || mode === "announcement") && (
                  <div className="group relative overflow-hidden rounded-3xl border border-studio-border bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imagePreview}
                      alt="Generated Dreyv social visual"
                      className="w-full cursor-zoom-in"
                      onClick={() => setLightboxUrl(imagePreview)}
                    />
                    <ImageActions
                      url={imagePreview}
                      alt="Generated Dreyv social visual"
                      filename={safeFilename(selectedJob?.title || `dreyv-${mode}`)}
                      onView={() => setLightboxUrl(imagePreview)}
                    />
                    <div className="flex items-center justify-between border-t border-studio-border p-3">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-studio-violet">
                        Saved to library
                      </span>
                      <Check className="h-3.5 w-3.5 text-studio-violet" />
                    </div>
                  </div>
                )}

                {/* Infographic */}
                {mode === "infographic" && infographic && (
                  <div className="space-y-3">
                    <InfographicCanvas
                      spec={infographic}
                      aspect={aspect === "9:16" ? "4:5" : (aspect as "1:1" | "4:5" | "16:9")}
                    />
                    <button
                      onClick={saveInfographic}
                      className="rounded-full border border-studio-border bg-white px-4 py-2 text-xs font-semibold text-studio-violet hover:bg-studio-violet-soft"
                    >
                      Save to library
                    </button>
                  </div>
                )}

                {/* Storyboard */}
                {mode === "video" && storyboard && <StoryboardCanvas spec={storyboard} />}

                {/* Empty state */}
                {!isGenerating && !hasOutput && (
                  <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-studio-border bg-white/60 p-8 text-center">
                    <DreyvStar size={28} />
                    <div className="text-sm font-semibold text-studio-fg">Pick a direction</div>
                    <p className="max-w-xs text-xs leading-5 text-studio-muted">
                      Choose any brief on the left. We&apos;ll generate copy, an infographic, or a storyboard on brand.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <AssetLibrary refreshKey={refreshKey} />
            )}
          </main>
        </div>
      </div>
    </div>
    {lightboxUrl && (
      <ImageLightbox
        url={lightboxUrl}
        alt="Generated Dreyv visual"
        filename={safeFilename(selectedJob?.title || `dreyv-${mode}`)}
        onClose={() => setLightboxUrl(null)}
      />
    )}
    </>
  );
}

function OutputSkeleton({ mode }: { mode: Mode }) {
  if (mode === "infographic") {
    return <div className="aspect-square w-full animate-pulse rounded-3xl bg-studio-violet-soft" />;
  }
  if (mode === "video") {
    return (
      <div className="space-y-3">
        <div className="h-32 animate-pulse rounded-3xl bg-studio-violet-soft" />
        <div className="h-20 animate-pulse rounded-2xl bg-studio-violet-soft" />
        <div className="h-20 animate-pulse rounded-2xl bg-studio-violet-soft" />
        <div className="h-20 animate-pulse rounded-2xl bg-studio-violet-soft" />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-40 animate-pulse rounded-3xl bg-studio-violet-soft" />
      ))}
    </div>
  );
}
