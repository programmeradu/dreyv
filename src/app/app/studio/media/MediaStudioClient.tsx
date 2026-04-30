"use client";

import * as React from "react";
import { FileText, Layout, Megaphone, Video, Sparkles, Loader2, Image as ImageIcon } from "lucide-react";
import type { AssetKind, Channel, CopyResult, InfographicSpec, VideoStoryboard } from "@/lib/media-studio/types";
import { CopyVariantCard } from "@/components/media-studio/CopyVariantCard";
import { InfographicCanvas } from "@/components/media-studio/InfographicCanvas";
import { StoryboardCanvas } from "@/components/media-studio/StoryboardCanvas";
import { AssetLibrary } from "@/components/media-studio/AssetLibrary";

/**
 * Dreyv Media Studio — internal brand/content workbench.
 *
 * Four generation modes. Light Stitch-inspired surface (white + solid
 * violet). All generation goes through /api/studio/media/* which enforces
 * Dreyv-team-only access server-side.
 */

type Mode = AssetKind;

const MODES: Array<{ id: Mode; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }> = [
  { id: "post", label: "Post", icon: FileText, hint: "X / LinkedIn / Instagram copy + image" },
  { id: "infographic", label: "Infographic", icon: Layout, hint: "Data-driven brand card" },
  { id: "announcement", label: "Announcement", icon: Megaphone, hint: "Launch / news visual" },
  { id: "video", label: "Video", icon: Video, hint: "Short-form storyboard" },
];

const CHANNELS: Channel[] = ["x", "linkedin", "instagram", "generic"];

export default function MediaStudioClient() {
  const [mode, setMode] = React.useState<Mode>("post");
  const [channel, setChannel] = React.useState<Channel>("x");
  const [prompt, setPrompt] = React.useState("");
  const [audience, setAudience] = React.useState("");
  const [aspect, setAspect] = React.useState<"1:1" | "16:9" | "9:16" | "4:5">("1:1");
  const [duration, setDuration] = React.useState(15);

  const [busy, setBusy] = React.useState<null | "copy" | "image" | "infographic" | "video">(null);
  const [copyResult, setCopyResult] = React.useState<CopyResult | null>(null);
  const [infographic, setInfographic] = React.useState<InfographicSpec | null>(null);
  const [storyboard, setStoryboard] = React.useState<VideoStoryboard | null>(null);
  const [imagePreview, setImagePreview] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const promptPlaceholder = React.useMemo(() => {
    switch (mode) {
      case "post":
        return "e.g. We just shipped Foresight v2 — a 30-day burn-rate forecast with one-click rebalance directives. Tell the story to crypto-native founders.";
      case "infographic":
        return "e.g. Three reasons treasury teams switch to Dreyv: real-time drift, foresight, and command-line directives. Use these stats: 30s drift detection, 12s foresight, 0.05% slippage.";
      case "announcement":
        return "e.g. Announcing Dreyv Cloud — managed, multi-sig-native. Available today on dreyv.com.";
      case "video":
        return "e.g. 15-second hook video for X explaining what Foresight does — open with a CFO scrolling spreadsheets, end on the Dreyv command line.";
    }
  }, [mode]);

  async function generate() {
    setError(null);
    if (!prompt.trim()) return;
    try {
      if (mode === "post" || mode === "announcement") {
        setBusy("copy");
        setCopyResult(null);
        const res = await fetch("/api/studio/media/generate-copy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: mode, channel, prompt, audience }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Copy generation failed");
        setCopyResult(json);
      } else if (mode === "infographic") {
        setBusy("infographic");
        setInfographic(null);
        const res = await fetch("/api/studio/media/generate-infographic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Infographic generation failed");
        setInfographic(json.spec);
      } else if (mode === "video") {
        setBusy("video");
        setStoryboard(null);
        const res = await fetch("/api/studio/media/generate-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, durationSeconds: duration, aspect: aspect === "9:16" ? "9:16" : "1:1" }),
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
  }

  async function generateImage() {
    setError(null);
    if (!prompt.trim()) return;
    setBusy("image");
    setImagePreview(null);
    try {
      const res = await fetch("/api/studio/media/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, kind: mode, channel, aspect, title: prompt.slice(0, 80) }),
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: mode,
        channel,
        title: variant.headline ?? variant.body.slice(0, 80),
        prompt,
        spec: { variant, altText: copyResult?.altText, hashtags: copyResult?.suggestedHashtags },
      }),
    });
    setRefreshKey((k) => k + 1);
  }

  async function saveInfographic() {
    if (!infographic) return;
    await fetch("/api/studio/media/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "infographic",
        title: infographic.title,
        prompt,
        spec: infographic,
      }),
    });
    setRefreshKey((k) => k + 1);
  }

  return (
    <div
      className="min-h-screen w-full bg-white text-[#0B0820]"
      style={{ fontFamily: "Manrope, ui-sans-serif, system-ui" }}
    >
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[60vh] overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-violet-300/30 blur-[120px]" />
        <div className="absolute -top-20 right-10 h-[300px] w-[300px] rounded-full bg-violet-400/30 blur-[100px]" />
      </div>

      <div className="mx-auto max-w-7xl px-6 py-10">
        {/* Header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-700">
              <Sparkles className="h-3.5 w-3.5" />
              Dreyv · Media Studio
            </div>
            <h1 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">
              Make on-brand content,<br className="hidden sm:block" /> in one calm sweep.
            </h1>
            <p className="mt-3 max-w-xl text-sm text-[#0B0820]/65">
              Internal workbench. Every variant is generated in Dreyv's voice — calm, precise,
              founder-to-founder. No emoji-spam, no buzzwords, no stock icons.
            </p>
          </div>
          <div className="rounded-full border border-violet-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-violet-700">
            Private · Team only
          </div>
        </header>

        {/* Mode tabs */}
        <div className="mt-8 grid grid-cols-2 gap-2 rounded-2xl border border-violet-100 bg-white p-2 sm:grid-cols-4">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={
                  "flex flex-col items-start gap-1 rounded-xl px-4 py-3 text-left transition " +
                  (active ? "bg-violet-600 text-white" : "hover:bg-violet-50 text-[#0B0820]")
                }
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Icon className="h-4 w-4" />
                  {m.label}
                </div>
                <span className={"text-[11px] " + (active ? "text-white/80" : "text-[#0B0820]/55")}>
                  {m.hint}
                </span>
              </button>
            );
          })}
        </div>

        {/* Workbench */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
          {/* Left — composer */}
          <div className="rounded-3xl border border-violet-200 bg-white p-5">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">
              Brief
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={promptPlaceholder}
              rows={8}
              className="mt-2 w-full resize-none rounded-2xl border border-violet-100 bg-white p-3 text-sm leading-relaxed text-[#0B0820] placeholder:text-[#0B0820]/35 focus:border-violet-400 focus:outline-none"
            />

            {(mode === "post" || mode === "announcement") && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">Channel</label>
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as Channel)}
                    className="mt-1 w-full rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
                  >
                    {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">Audience</label>
                  <input
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    placeholder="e.g. crypto-CFOs"
                    className="mt-1 w-full rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {(mode === "post" || mode === "announcement" || mode === "infographic") && (
              <div className="mt-4">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">Aspect</label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(["1:1", "4:5", "16:9", "9:16"] as const).map((a) => (
                    <button
                      key={a}
                      onClick={() => setAspect(a)}
                      className={
                        "rounded-full border px-3 py-1 text-xs font-semibold " +
                        (aspect === a
                          ? "border-violet-600 bg-violet-600 text-white"
                          : "border-violet-200 bg-white text-[#0B0820]/70 hover:bg-violet-50")
                      }
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === "video" && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">Duration</label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
                  >
                    {[5, 10, 15, 30].map((d) => <option key={d} value={d}>{d}s</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-violet-700">Aspect</label>
                  <select
                    value={aspect}
                    onChange={(e) => setAspect(e.target.value as typeof aspect)}
                    className="mt-1 w-full rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
                  >
                    <option value="9:16">9:16</option>
                    <option value="1:1">1:1</option>
                    <option value="16:9">16:9</option>
                  </select>
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={generate}
                disabled={busy !== null || !prompt.trim()}
                className="flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {busy === "copy" || busy === "infographic" || busy === "video" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {mode === "post" || mode === "announcement"
                  ? "Generate copy variants"
                  : mode === "infographic"
                  ? "Generate infographic"
                  : "Generate storyboard"}
              </button>

              {(mode === "post" || mode === "announcement") && (
                <button
                  onClick={generateImage}
                  disabled={busy !== null || !prompt.trim()}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-violet-300 bg-white px-4 py-3 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                >
                  {busy === "image" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                  Generate matching image
                </button>
              )}
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {error}
              </div>
            )}
          </div>

          {/* Right — preview */}
          <div className="space-y-5">
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
                  <div className="rounded-2xl border border-violet-100 bg-white p-3 text-xs text-[#0B0820]/70">
                    <span className="font-semibold text-violet-700">Hashtags:</span>{" "}
                    {copyResult.suggestedHashtags.map((h) => `#${h}`).join("  ")}
                  </div>
                )}
              </div>
            )}

            {imagePreview && (mode === "post" || mode === "announcement") && (
              <div className="overflow-hidden rounded-3xl border border-violet-200 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="Generated" className="w-full" />
              </div>
            )}

            {mode === "infographic" && infographic && (
              <div className="space-y-3">
                <InfographicCanvas spec={infographic} aspect={aspect === "9:16" ? "4:5" : (aspect as "1:1" | "4:5" | "16:9")} />
                <button
                  onClick={saveInfographic}
                  className="rounded-full border border-violet-200 px-4 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50"
                >
                  Save to library
                </button>
              </div>
            )}

            {mode === "video" && storyboard && <StoryboardCanvas spec={storyboard} />}

            {!copyResult && !infographic && !storyboard && !imagePreview && (
              <div className="flex aspect-[4/3] items-center justify-center rounded-3xl border border-dashed border-violet-200 bg-white text-sm text-[#0B0820]/45">
                Your generation will appear here.
              </div>
            )}
          </div>
        </div>

        {/* Library */}
        <section className="mt-12">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-700">Library</div>
              <h2 className="mt-1 text-2xl font-bold tracking-tight">Recent assets</h2>
            </div>
            <span className="text-xs text-[#0B0820]/55">Only you can see your assets.</span>
          </div>
          <div className="mt-4">
            <AssetLibrary refreshKey={refreshKey} />
          </div>
        </section>
      </div>
    </div>
  );
}
