"use client";

import * as React from "react";
import { FileText, Layout, Megaphone, Video, Loader2, Image as ImageIcon, RefreshCw } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import type { AssetKind, Channel, ContentSuggestion, CopyResult, InfographicSpec, VideoStoryboard } from "@/lib/media-studio/types";
import { CopyVariantCard } from "@/components/media-studio/CopyVariantCard";
import { InfographicCanvas } from "@/components/media-studio/InfographicCanvas";
import { StoryboardCanvas } from "@/components/media-studio/StoryboardCanvas";
import { AssetLibrary } from "@/components/media-studio/AssetLibrary";
import { studioAuthHeaders, studioJsonHeaders } from "@/lib/media-studio/client-auth";

type Mode = AssetKind;

type StudioJob = ContentSuggestion & {
  aspect: "1:1" | "16:9" | "9:16" | "4:5";
  durationSeconds: number;
};

const MODES: Array<{ id: Mode; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }> = [
  { id: "post", label: "Post", icon: FileText, hint: "Copy + image direction" },
  { id: "infographic", label: "Infographic", icon: Layout, hint: "Structured brand card" },
  { id: "announcement", label: "Announcement", icon: Megaphone, hint: "Launch visual + copy" },
  { id: "video", label: "Video", icon: Video, hint: "Short-form storyboard" },
];

const FALLBACK_JOBS: StudioJob[] = [
  {
    id: "runway-drift",
    kind: "post",
    channel: "x",
    title: "Runway drift is silent until it is not",
    brief: "Write a sharp X post for crypto-native founders about treasury drift: stablecoin runway changes, token volatility, and why Dreyv turns drift into a directive before it becomes a meeting.",
    audience: "crypto founders",
    aspect: "1:1",
    durationSeconds: 15,
  },
  {
    id: "foresight-loop",
    kind: "infographic",
    channel: "linkedin",
    title: "From balance sheet to next move",
    brief: "Create an infographic showing Dreyv's treasury operating loop: observe balances, detect drift, forecast runway, propose a directive, execute through multisig. Do not invent metrics.",
    audience: "DAO operators",
    aspect: "4:5",
    durationSeconds: 15,
  },
  {
    id: "atlas-front-door",
    kind: "announcement",
    channel: "linkedin",
    title: "Atlas as the read-only front door",
    brief: "Draft a launch-style announcement for Atlas: a read-only Solana treasury intelligence surface for comparing tokens, routes, and risk before connecting a wallet.",
    audience: "Solana teams",
    aspect: "16:9",
    durationSeconds: 15,
  },
  {
    id: "one-calm-command",
    kind: "video",
    channel: "x",
    title: "One calm command",
    brief: "Storyboard a short motion post showing a founder moving from spreadsheet anxiety to one Dreyv command that explains runway, drift, and the next treasury directive.",
    audience: "founder-operators",
    aspect: "9:16",
    durationSeconds: 15,
  },
];

function normalizeJob(suggestion: ContentSuggestion): StudioJob {
  return {
    ...suggestion,
    aspect: suggestion.aspect ?? (suggestion.kind === "video" ? "9:16" : "1:1"),
    durationSeconds: suggestion.durationSeconds ?? 15,
  };
}

export default function MediaStudioClient() {
  const [jobs, setJobs] = React.useState<StudioJob[]>(FALLBACK_JOBS);
  const [selectedId, setSelectedId] = React.useState(FALLBACK_JOBS[0].id);
  const [mode, setMode] = React.useState<Mode>(FALLBACK_JOBS[0].kind);
  const [channel, setChannel] = React.useState<Channel>(FALLBACK_JOBS[0].channel);
  const [aspect, setAspect] = React.useState<"1:1" | "16:9" | "9:16" | "4:5">(FALLBACK_JOBS[0].aspect);
  const [duration, setDuration] = React.useState(FALLBACK_JOBS[0].durationSeconds);

  const [busy, setBusy] = React.useState<null | "suggestions" | "copy" | "image" | "infographic" | "video">(null);
  const [copyResult, setCopyResult] = React.useState<CopyResult | null>(null);
  const [infographic, setInfographic] = React.useState<InfographicSpec | null>(null);
  const [storyboard, setStoryboard] = React.useState<VideoStoryboard | null>(null);
  const [imagePreview, setImagePreview] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
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

  const applyJob = React.useCallback((job: StudioJob) => {
    setSelectedId(job.id);
    setMode(job.kind);
    setChannel(job.channel);
    setAspect(job.aspect);
    setDuration(job.durationSeconds);
    resetOutput();
  }, [resetOutput]);

  const generateFor = React.useCallback(async (job: StudioJob) => {
    setError(null);
    setNotice(null);
    try {
      if (job.kind === "post" || job.kind === "announcement") {
        setBusy("copy");
        setCopyResult(null);
        const res = await fetch("/api/studio/media/generate-copy", {
          method: "POST",
          headers: studioJsonHeaders(),
          body: JSON.stringify({ kind: job.kind, channel: job.channel, prompt: job.brief, audience: job.audience }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Copy generation failed");
        setCopyResult(json);
      } else if (job.kind === "infographic") {
        setBusy("infographic");
        setInfographic(null);
        const res = await fetch("/api/studio/media/generate-infographic", {
          method: "POST",
          headers: studioJsonHeaders(),
          body: JSON.stringify({ prompt: job.brief }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Infographic generation failed");
        setInfographic(json.spec);
      } else {
        setBusy("video");
        setStoryboard(null);
        const res = await fetch("/api/studio/media/generate-video", {
          method: "POST",
          headers: studioJsonHeaders(),
          body: JSON.stringify({ prompt: job.brief, durationSeconds: job.durationSeconds, aspect: job.aspect === "9:16" ? "9:16" : "1:1" }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Video generation failed");
        setStoryboard(json.spec);
        setRefreshKey((k) => k + 1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }, []);

  const loadSuggestions = React.useCallback(async ({ autoRun }: { autoRun: boolean }) => {
    setBusy("suggestions");
    setError(null);
    try {
      const res = await fetch("/api/studio/media/suggestions", { headers: studioAuthHeaders() });
      const json = await res.json();
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
  }, [applyJob, generateFor]);

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
      const json = await res.json();
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

  return (
    <div className="min-h-screen w-full bg-studio-bg font-manrope text-studio-fg">
      <div className="mx-auto max-w-7xl px-6 py-8 lg:py-10">
        <header className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-studio-violet">
              <DreyvStar size={14} />
              Dreyv · Media Studio
            </div>
            <h1 className="mt-2 max-w-3xl text-4xl font-bold leading-none tracking-normal md:text-5xl">
              Ready content, on brand by default.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-studio-muted">
              The studio now proposes the briefs and starts the first generation automatically. Pick a direction, then regenerate or export.
            </p>
          </div>
          <div className="justify-self-start rounded-full border border-studio-border bg-studio-surface px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-studio-violet lg:justify-self-end">
            Private · Team only
          </div>
        </header>

        <div className="mt-7 grid grid-cols-2 gap-2 rounded-2xl border border-studio-border bg-studio-surface p-2 sm:grid-cols-4">
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
                  "flex min-h-20 flex-col items-start gap-1 rounded-xl px-4 py-3 text-left transition " +
                  (active ? "bg-studio-violet text-primary-foreground" : "text-studio-fg hover:bg-studio-violet-soft")
                }
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Icon className="h-4 w-4" />
                  {m.label}
                </div>
                <span className={"text-[11px] " + (active ? "text-primary-foreground/80" : "text-studio-muted")}>{m.hint}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[430px_1fr]">
          <div className="space-y-4">
            <section className="rounded-3xl border border-studio-border bg-studio-surface p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-studio-violet">Generated directions</div>
                  <h2 className="mt-1 text-xl font-bold tracking-normal">Pick one, or let the first run.</h2>
                </div>
                <button
                  onClick={() => loadSuggestions({ autoRun: false })}
                  disabled={busy !== null}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-studio-border text-studio-violet hover:bg-studio-violet-soft disabled:opacity-50"
                  aria-label="Refresh suggestions"
                >
                  {busy === "suggestions" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {jobs.map((job) => {
                  const active = selectedJob.id === job.id;
                  return (
                    <button
                      key={job.id}
                      onClick={() => applyJob(job)}
                      className={
                        "w-full rounded-2xl border p-3 text-left transition " +
                        (active ? "border-studio-violet bg-studio-violet-soft" : "border-studio-border bg-studio-surface hover:bg-studio-violet-soft")
                      }
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-bold tracking-normal">{job.title}</span>
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-studio-violet">{job.kind}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-studio-muted">{job.brief}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-3xl border border-studio-border bg-studio-surface p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-studio-violet">Selected brief</div>
              <h3 className="mt-2 text-lg font-bold tracking-normal">{selectedJob.title}</h3>
              <p className="mt-2 text-sm leading-6 text-studio-muted">{selectedJob.brief}</p>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl border border-studio-border bg-studio-surface p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-studio-violet">Channel</div>
                  <div className="mt-1 font-semibold">{channel}</div>
                </div>
                <div className="rounded-2xl border border-studio-border bg-studio-surface p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-studio-violet">Format</div>
                  <div className="mt-1 font-semibold">{mode === "video" ? `${duration}s · ${aspect}` : aspect}</div>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-2">
                <button
                  onClick={() => generateFor(selectedJob)}
                  disabled={busy !== null}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-studio-violet px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {busy === "copy" || busy === "infographic" || busy === "video" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DreyvStar size={14} />}
                  Generate this direction
                </button>
                {(mode === "post" || mode === "announcement") && (
                  <button
                    onClick={generateImage}
                    disabled={busy !== null}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-studio-border bg-studio-surface px-4 py-3 text-sm font-semibold text-studio-violet hover:bg-studio-violet-soft disabled:opacity-50"
                  >
                    {busy === "image" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                    Generate matching image
                  </button>
                )}
              </div>

              {notice && <div className="mt-4 rounded-2xl border border-studio-border bg-studio-violet-soft p-3 text-xs leading-5 text-studio-muted">{notice}</div>}
              {error && <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs leading-5 text-destructive">{error}</div>}
            </section>
          </div>

          <div className="space-y-5">
            {(mode === "post" || mode === "announcement") && copyResult && (
              <div className="space-y-3">
                {copyResult.variants.map((v, i) => (
                  <CopyVariantCard key={i} index={i + 1} headline={v.headline} body={v.body} cta={v.cta} onSave={() => saveCopy(v)} />
                ))}
                {(copyResult.suggestedHashtags?.length || 0) > 0 && (
                  <div className="rounded-2xl border border-studio-border bg-studio-surface p-3 text-xs text-studio-muted">
                    <span className="font-semibold text-studio-violet">Hashtags:</span> {copyResult.suggestedHashtags.map((h) => `#${h}`).join("  ")}
                  </div>
                )}
              </div>
            )}

            {imagePreview && (mode === "post" || mode === "announcement") && (
              <div className="overflow-hidden rounded-3xl border border-studio-border bg-studio-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="Generated Dreyv social visual" className="w-full" />
              </div>
            )}

            {mode === "infographic" && infographic && (
              <div className="space-y-3">
                <InfographicCanvas spec={infographic} aspect={aspect === "9:16" ? "4:5" : (aspect as "1:1" | "4:5" | "16:9")} />
                <button onClick={saveInfographic} className="rounded-full border border-studio-border px-4 py-2 text-xs font-semibold text-studio-violet hover:bg-studio-violet-soft">
                  Save to library
                </button>
              </div>
            )}

            {mode === "video" && storyboard && <StoryboardCanvas spec={storyboard} />}

            {!copyResult && !infographic && !storyboard && !imagePreview && (
              <div className="flex aspect-[4/3] items-center justify-center rounded-3xl border border-dashed border-studio-border bg-studio-surface text-sm text-studio-muted">
                {busy ? "Generating the first direction…" : "Choose a direction to generate."}
              </div>
            )}
          </div>
        </div>

        <section className="mt-12">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-studio-violet">Library</div>
              <h2 className="mt-1 text-2xl font-bold tracking-normal">Recent assets</h2>
            </div>
            <span className="text-xs text-studio-muted">Studio assets saved from generated outputs.</span>
          </div>
          <div className="mt-4">
            <AssetLibrary refreshKey={refreshKey} />
          </div>
        </section>
      </div>
    </div>
  );
}
