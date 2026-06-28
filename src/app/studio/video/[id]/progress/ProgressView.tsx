"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, ArrowLeft, CheckCircle2, AlertCircle, Clock, RefreshCw, Film } from "lucide-react";
import { studioAuthHeaders } from "@/lib/media-studio/client-auth";

type ShotProgress = {
  n: number;
  status: "queued" | "rendering" | "done" | "failed";
  submittedAt?: string | null;
  completedAt?: string | null;
  reshootCount?: number;
  url?: string | null;
  observation?: {
    ok: boolean;
    issues: string[];
    durationSec: number | null;
    lastWords: string | null;
    lastAction: string | null;
    settingFingerprint: string | null;
    needsReshoot: boolean;
    metrics?: Record<string, unknown>;
  } | null;
};

type StitchProgress = {
  phase: "idle" | "normalizing" | "concat" | "done";
  attempts: number;
  segmentsDone: number;
  segmentsTotal: number;
  segments: Array<{ n: number; status: "pending" | "ready"; key?: string }>;
  lastChunkAt?: string | null;
  completedAt?: string | null;
};

type Job = {
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
  progress?: {
    shots: ShotProgress[];
    stitch: StitchProgress;
    status: string;
  } | null;
};

function StatusDot({ s }: { s: ShotProgress["status"] | "pending" | "ready" }) {
  const cls =
    s === "done" || s === "ready"
      ? "bg-emerald-500"
      : s === "rendering" || s === "pending"
        ? "bg-violet-500 animate-pulse"
        : s === "failed"
          ? "bg-rose-500"
          : "bg-slate-300";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} />;
}

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch { return "—"; }
}

export default function ProgressView({ jobId }: { jobId: string }) {
  const [job, setJob] = React.useState<Job | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = React.useState<number>(Date.now());

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/studio/video/render?id=${encodeURIComponent(jobId)}`, {
          headers: studioAuthHeaders(),
          cache: "no-store",
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(body.slice(0, 200) || `status ${res.status}`);
        }
        const data = (await res.json()) as Job;
        if (cancelled) return;
        setJob(data);
        setRefreshedAt(Date.now());
        setError(null);
        if (data.status !== "done" && data.status !== "failed") {
          timer = setTimeout(tick, 4000);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        timer = setTimeout(tick, 6000);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [jobId]);

  const progress = job?.progress ?? null;
  const isDone = job?.status === "done";
  const isFailed = job?.status === "failed";

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <Link
          href="/studio/video"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 hover:text-violet-900"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Video Studio
        </Link>

        <header className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Render progress</h1>
            <p className="mt-1 text-sm text-slate-500">
              Job <code className="font-mono text-xs">{jobId.slice(0, 8)}</code> ·{" "}
              {job?.model ?? "—"} · last refresh {fmtTime(new Date(refreshedAt).toISOString())}
            </p>
          </div>
          <div
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              isDone
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : isFailed
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-violet-200 bg-violet-50 text-violet-700"
            }`}
          >
            {isDone ? (
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> Done</span>
            ) : isFailed ? (
              <span className="inline-flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> Failed</span>
            ) : (
              <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {job?.status ?? "loading"}</span>
            )}
          </div>
        </header>

        {error ? (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            Polling glitch (retrying): {error}
          </p>
        ) : null}
        {job?.error ? (
          <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">
            {job.error}
          </p>
        ) : null}

        {/* Shots */}
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Per-shot render & QA</h2>
          <ol className="mt-3 space-y-3">
            {(progress?.shots ?? Array.from({ length: job?.shots_total ?? 0 }, (_v, i): ShotProgress => ({
              n: i + 1, status: "queued",
            }))).map((s) => (
              <li key={s.n} className="rounded-3xl border border-violet-100 bg-white p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <StatusDot s={s.status} />
                    <div className="text-sm font-semibold">Shot {s.n}</div>
                    {s.reshootCount && s.reshootCount > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        <RefreshCw className="h-3 w-3" /> reshoot ×{s.reshootCount}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtTime(s.submittedAt)} → {fmtTime(s.completedAt)}</span>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer" className="font-semibold text-violet-700 hover:text-violet-900">
                        open clip
                      </a>
                    ) : null}
                  </div>
                </div>
                {s.observation ? (
                  <div className="mt-3 grid gap-3 text-xs text-slate-600 sm:grid-cols-2">
                    {s.observation.issues.length ? (
                      <div className="sm:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                        QA flags: {s.observation.issues.join(" · ")}
                      </div>
                    ) : (
                      <div className="sm:col-span-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
                        QA clean ({s.observation.durationSec?.toFixed(1) ?? "?"}s)
                      </div>
                    )}
                    {s.observation.lastWords ? (
                      <div>
                        <div className="font-semibold text-slate-700">Spoken</div>
                        <div className="mt-0.5 italic">&ldquo;{s.observation.lastWords}&rdquo;</div>
                      </div>
                    ) : null}
                    {s.observation.lastAction ? (
                      <div>
                        <div className="font-semibold text-slate-700">Last action</div>
                        <div className="mt-0.5">{s.observation.lastAction}</div>
                      </div>
                    ) : null}
                    {s.observation.settingFingerprint ? (
                      <div className="sm:col-span-2">
                        <div className="font-semibold text-slate-700">Setting lock for next shot</div>
                        <div className="mt-0.5">{s.observation.settingFingerprint}</div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        {/* Stitch chunks */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Stitch chunks · phase: {progress?.stitch.phase ?? "idle"}
          </h2>
          <p className="mt-2 text-xs text-slate-500">
            Each shot is normalized to 1080×1920 with grading + burned captions in its own lambda, then concat-copied into the final MP4.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(progress?.stitch.segments ?? []).map((seg) => (
              <li
                key={seg.n}
                className={`rounded-2xl border px-3 py-3 text-xs font-semibold ${
                  seg.status === "ready"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-violet-100 bg-white text-slate-500"
                }`}
              >
                <div className="flex items-center gap-2">
                  <StatusDot s={seg.status} />
                  Seg {seg.n}
                </div>
                <div className="mt-1 text-[10px] font-normal text-slate-500">
                  {seg.status === "ready" ? "normalized → R2" : "pending"}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 text-xs text-slate-500">
            Attempts: {progress?.stitch.attempts ?? 0} · last chunk {fmtTime(progress?.stitch.lastChunkAt)} ·{" "}
            concat {progress?.stitch.phase === "done" ? "complete" : "pending"}
          </div>
        </section>

        {/* Final */}
        {job?.final_url ? (
          <section className="mt-10 rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
              <Film className="h-4 w-4" /> Final stitched MP4 ready
              {job.duration_sec ? <span className="text-emerald-600">· {job.duration_sec}s</span> : null}
            </div>
            <video src={job.final_url} controls className="mt-3 w-full max-w-sm rounded-2xl border border-emerald-200 bg-black" />
            <a
              href={job.final_url}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-900"
              download
            >
              Download MP4
            </a>
          </section>
        ) : null}
      </div>
    </main>
  );
}
