"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, Copy, Check, ArrowUpRight, RefreshCw, Video as VideoIcon } from "lucide-react";
import StudioPasswordGate from "../StudioPasswordGate";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { studioJsonHeaders, studioAuthHeaders } from "@/lib/media-studio/client-auth";
import { DREYV_DEV_SURFACE } from "@/lib/media-studio/developers-context";
import { VIDEO_ANGLES } from "@/lib/media-studio/video-tools";

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

type Trends = {
  source: "firecrawl" | "tikapi" | "bundled";
  sounds: { name: string; usageNote?: string }[];
  hashtags: { tag: string; note?: string }[];
  formats: { id: string; label: string; note: string }[];
  fetchedAt: string;
  note?: string;
};

const FORMATS = [
  { id: "pov", label: "POV Immersion (15–30s)" },
  { id: "til", label: "Today Years Old / TIL (15–20s)" },
  { id: "skit", label: "Skit / Micro-Comedy (15–20s)" },
  { id: "explainer", label: "Talking-Head Explainer (30–45s)" },
  { id: "trend-remix", label: "Trend Remix (15–30s)" },
  { id: "meme-overlay", label: "Meme Overlay / Text-driven (10–20s)" },
  { id: "before-after", label: "Before / After (15–30s)" },
  { id: "tutorial", label: "Tutorial (30–60s)" },
];

const TOOLS = [
  { id: "", label: "Let model pick" },
  { id: "hedra", label: "Hedra (mascot lip-sync)" },
  { id: "hailuo", label: "Hailuo / MiniMax ($7.99/mo)" },
  { id: "kling", label: "Kling 3.0" },
  { id: "veo3-fast", label: "Veo 3 Fast ($0.15/sec)" },
  { id: "wan22", label: "Wan 2.2 (self-hosted free)" },
  { id: "runway-gen4", label: "Runway Gen-4 Reference" },
];

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

export default function VideoStudioShell({ unlocked }: { unlocked: boolean }) {
  const [isUnlocked, setIsUnlocked] = React.useState(unlocked);
  const [formatId, setFormatId] = React.useState("explainer");
  const [angle, setAngle] = React.useState<string>(VIDEO_ANGLES[0].id);
  const [customAngle, setCustomAngle] = React.useState("");
  const [primaryTool, setPrimaryTool] = React.useState("");
  const [trendingSound, setTrendingSound] = React.useState("");
  const [audience, setAudience] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pack, setPack] = React.useState<Pack | null>(null);

  const [trends, setTrends] = React.useState<Trends | null>(null);
  const [trendsLoading, setTrendsLoading] = React.useState(false);

  // ---- Video render job (fal.ai pipeline) -----------------------------
  type RenderJob = {
    id: string;
    status: "queued" | "rendering_shots" | "stitching" | "done" | "failed";
    shots_total: number;
    shots_done: number;
    shot_urls: string[];
    final_url: string | null;
    duration_sec: number | null;
    error: string | null;
  };
  const [renderJob, setRenderJob] = React.useState<RenderJob | null>(null);
  const [renderStarting, setRenderStarting] = React.useState(false);
  const [renderError, setRenderError] = React.useState<string | null>(null);

  const startRender = React.useCallback(async () => {
    if (!pack) return;
    setRenderError(null);
    setRenderStarting(true);
    try {
      const res = await fetch("/api/studio/video/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setRenderJob({
        id: j.jobId,
        status: "queued",
        shots_total: pack.shotList.length,
        shots_done: 0,
        shot_urls: [],
        final_url: null,
        duration_sec: null,
        error: j.warning ?? null,
      });
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : String(e));
    } finally {
      setRenderStarting(false);
    }
  }, [pack]);

  // Poll job until terminal.
  React.useEffect(() => {
    if (!renderJob || renderJob.status === "done" || renderJob.status === "failed") return;
    const id = renderJob.id;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/studio/video/render?id=${id}`);
        const j = await r.json();
        if (!cancelled && r.ok) setRenderJob((prev) => (prev && prev.id === id ? { ...prev, ...j } : prev));
      } catch {}
    };
    const handle = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [renderJob]);

  const loadTrends = React.useCallback(async () => {
    setTrendsLoading(true);
    try {
      const r = await fetch("/api/studio/video/trends", { headers: studioAuthHeaders() });
      const j = await r.json();
      if (r.ok) setTrends(j as Trends);
    } catch {
      // silent — bundled fallback is always rendered
    } finally {
      setTrendsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (isUnlocked && !trends) void loadTrends();
  }, [isUnlocked, trends, loadTrends]);

  if (!isUnlocked) return <StudioPasswordGate onUnlocked={() => setIsUnlocked(true)} />;

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setPack(null);
    try {
      const r = await fetch("/api/studio/video/draft", {
        method: "POST",
        headers: studioJsonHeaders(),
        body: JSON.stringify({
          formatId,
          angle,
          customAngle: angle === "custom" ? customAngle : undefined,
          primaryTool: primaryTool || undefined,
          trendingSound: trendingSound || undefined,
          audience: audience || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) setError(j.error || "Failed to generate");
      else setPack(j as Pack);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white font-manrope text-slate-900">
      <header className="sticky top-0 z-20 border-b border-violet-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <VideoIcon className="h-4 w-4 text-violet-700" />
            <span className="text-sm font-semibold">Dreyv Studio · TikTok video packs</span>
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

      <section className="border-b border-violet-100 bg-violet-50/40">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <h1 className="text-3xl font-bold tracking-tight">Generate a TikTok pack for the Dreyv mascot</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            One generation = a full production plan: hook, shot list with per-tool prompts (Hedra · Hailuo · Kling · Veo 3 · Wan 2.2), voiceover, burned captions, hashtags, sound, posting window, mascot consistency notes. Nothing renders or posts automatically — you paste the prompts into the tools you have access to.
          </p>

          <form onSubmit={generate} className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Format archetype</span>
              <select
                value={formatId}
                onChange={(e) => setFormatId(e.target.value)}
                className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
              >
                {FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Angle</span>
              <select
                value={angle}
                onChange={(e) => setAngle(e.target.value)}
                className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
              >
                {VIDEO_ANGLES.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
                <option value="custom">Custom angle…</option>
              </select>
              {angle !== "custom" && (() => {
                const a = VIDEO_ANGLES.find((x) => x.id === angle);
                if (!a) return null;
                return (
                  <div className="mt-1 rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2 text-[12px] leading-relaxed text-slate-700">
                    <div className="text-slate-900">{a.teaser}</div>
                    <div className="mt-1 text-[11px] text-violet-700">
                      Hook ideas: {a.hookIdeas.map((h) => `“${h}”`).join(" · ")}
                    </div>
                  </div>
                );
              })()}
            </label>


            {angle === "custom" && (
              <label className="flex flex-col gap-1.5 md:col-span-2">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Custom angle</span>
                <textarea
                  value={customAngle}
                  onChange={(e) => setCustomAngle(e.target.value)}
                  rows={2}
                  placeholder="What is this video actually about? Reference the specific capability or moment."
                  className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
                />
              </label>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Primary tool (optional)</span>
              <select
                value={primaryTool}
                onChange={(e) => setPrimaryTool(e.target.value)}
                className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
              >
                {TOOLS.map((t) => (
                  <option key={t.id || "auto"} value={t.id}>{t.label}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Trending sound (optional)</span>
              <input
                value={trendingSound}
                onChange={(e) => setTrendingSound(e.target.value)}
                list="dreyv-trending-sounds"
                placeholder="e.g. 'Aesthetic chill lo-fi loop' — pick from trends panel"
                className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
              />
              <datalist id="dreyv-trending-sounds">
                {trends?.sounds.map((s) => (
                  <option key={s.name} value={s.name}>{s.usageNote}</option>
                ))}
              </datalist>
            </label>

            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Audience focus (optional)</span>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. solo devs trying MCP for the first time, treasury operators on Solana"
                className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
              />
            </label>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={loading || (angle === "custom" && !customAngle.trim())}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                {loading ? "Generating pack…" : "Generate video pack"}
              </button>
            </div>
          </form>

          {error && (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}
        </div>
      </section>

      {/* Trends panel */}
      <section className="border-b border-violet-100">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-violet-700">Trending signals</h2>
              <p className="mt-1 text-xs text-slate-500">
                Source: <strong>{trends?.source ?? "—"}</strong>
                {trends?.note && <> · {trends.note}</>}
                {trends?.fetchedAt && <> · {new Date(trends.fetchedAt).toLocaleString()}</>}
              </p>
            </div>
            <button
              type="button"
              onClick={loadTrends}
              disabled={trendsLoading}
              className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-4 py-2 text-xs font-semibold text-violet-700 hover:border-violet-400 disabled:opacity-50"
            >
              {trendsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Refresh
            </button>
          </div>
          {trends && (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-violet-100 bg-white p-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Sounds</h3>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {trends.sounds.map((s) => (
                    <li key={s.name} className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-800">{s.name}</div>
                        {s.usageNote && <div className="text-xs text-slate-500">{s.usageNote}</div>}
                      </div>
                      <button
                        type="button"
                        onClick={() => setTrendingSound(s.name)}
                        className="rounded-full border border-violet-200 px-2 py-0.5 text-[10px] font-semibold text-violet-700 hover:border-violet-400"
                      >
                        Use
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-violet-100 bg-white p-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Hashtags</h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {trends.hashtags.map((h) => (
                    <span key={h.tag} className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                      {h.tag}
                      {h.note && <span className="ml-1 text-[10px] text-slate-500">· {h.note}</span>}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {pack && (
        <section className="mx-auto max-w-7xl px-6 py-10">
          <div className="mb-6 flex items-baseline justify-between gap-4">
            <h2 className="text-2xl font-bold tracking-tight">{pack.formatLabel}</h2>
            <span className="text-xs text-slate-500">{pack.whyItWorks}</span>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
            <div className="space-y-6">
              {/* HOOK */}
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

              {/* SHOT LIST */}
              <div className="rounded-3xl border border-violet-100 bg-white p-6">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-violet-700">Shot list & per-tool prompts</h3>
                <ol className="space-y-4">
                  {pack.shotList.map((shot) => (
                    <li key={shot.n} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs">
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
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                            Paste into {shot.recommendedTool}
                          </span>
                          <CopyButton text={shot.toolPrompt} />
                        </div>
                        <pre className="whitespace-pre-wrap font-mono text-xs leading-5 text-slate-100">{shot.toolPrompt}</pre>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              {/* VOICEOVER */}
              <div className="rounded-3xl border border-violet-100 bg-white p-6">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-violet-700">Voiceover script (ElevenLabs → Hedra)</h3>
                  <CopyButton text={pack.voiceoverScript} />
                </div>
                <pre className="whitespace-pre-wrap font-manrope text-sm leading-6 text-slate-800">{pack.voiceoverScript}</pre>
              </div>

              {/* CAPTIONS */}
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

              <div className="rounded-3xl border border-violet-100 bg-white p-6 text-xs text-slate-500">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-violet-700">Reminders</h3>
                <ul className="mt-3 space-y-1.5">
                  <li>· Always re-seed I2V from the original mascot PNG, never a generated frame.</li>
                  <li>· Lock lighting: soft indoor warm 3200K across every shot.</li>
                  <li>· Burn captions in CapCut — 60% of TikTok plays muted.</li>
                  <li>· First 1.5s decides whether the algorithm advances you.</li>
                  <li>· Post from your phone (TikTok deboosts API posts for organic).</li>
                </ul>
              </div>
            </aside>
          </div>
        </section>
      )}
    </div>
  );
}
