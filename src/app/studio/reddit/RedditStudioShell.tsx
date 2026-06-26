"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, Copy, Check, ArrowUpRight } from "lucide-react";
import StudioPasswordGate from "../StudioPasswordGate";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { studioJsonHeaders } from "@/lib/media-studio/client-auth";
import { DREYV_DEV_SURFACE } from "@/lib/media-studio/developers-context";

type Draft = {
  titles: string[];
  body: string;
  firstComment: string;
  postingWindow: string;
  complianceChecks: string[];
};

const SUBREDDITS = [
  { name: "ClaudeAI", note: "AI-tool friendly, demo-led" },
  { name: "cursor", note: "MCP + IDE crowd" },
  { name: "mcp", note: "core MCP community" },
  { name: "LocalLLaMA", note: "technical, skeptical of hype" },
  { name: "AI_Agents", note: "agent builders" },
  { name: "OpenAI", note: "broad, lead with demo" },
  { name: "singularity", note: "broad, narrative-friendly" },
  { name: "solana", note: "crypto-native, lead with on-chain" },
  { name: "defi", note: "yield + risk crowd" },
  { name: "ethdev", note: "builders, technical" },
  { name: "CryptoCurrency", note: "anti-shill, utility-first only" },
  { name: "web3", note: "broad, mixed" },
  { name: "SideProject", note: "show-and-tell, no crypto pitch" },
  { name: "SaaS", note: "founders, ROI-led" },
  { name: "programming", note: "skeptical, dev-tool angle only" },
];

const TONES = [
  { id: "founder", label: "Founder-casual" },
  { id: "technical", label: "Technical-deep" },
  { id: "contrarian", label: "Contrarian take" },
] as const;

const LENGTHS = [
  { id: "short", label: "Short (<150w)" },
  { id: "medium", label: "Medium (250–400w)" },
  { id: "long", label: "Long (500w+)" },
] as const;

const PERSPECTIVES = [
  { id: "founder", label: "Founder (1st person)", hint: "You built it. You're sharing." },
  { id: "discoverer", label: "User who found it (3rd person)", hint: "You stumbled on Dreyv and are telling the sub." },
  { id: "recommender", label: "Recommender (3rd person)", hint: "Someone asked for X — you've been using Dreyv, here's why." },
  { id: "auto", label: "Let the model pick", hint: "Best fit for the sub + angle." },
] as const;

function CopyButton({ text }: { text: string }) {
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
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function RedditStudioShell({ unlocked }: { unlocked: boolean }) {
  const [isUnlocked, setIsUnlocked] = React.useState(unlocked);
  const [subreddit, setSubreddit] = React.useState("ClaudeAI");
  const [angle, setAngle] = React.useState<string>(DREYV_DEV_SURFACE.heroHooks[0].id);
  const [customAngle, setCustomAngle] = React.useState("");
  const [tone, setTone] = React.useState<(typeof TONES)[number]["id"]>("founder");
  const [length, setLength] = React.useState<(typeof LENGTHS)[number]["id"]>("medium");
  const [audience, setAudience] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);

  if (!isUnlocked) return <StudioPasswordGate onUnlocked={() => setIsUnlocked(true)} />;

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setDraft(null);
    try {
      const r = await fetch("/api/studio/reddit/draft", {
        method: "POST",
        headers: studioJsonHeaders(),
        body: JSON.stringify({
          subreddit,
          angle,
          customAngle: angle === "custom" ? customAngle : undefined,
          tone,
          length,
          audience: audience || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || "Failed to generate");
      } else {
        setDraft(j as Draft);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  const subMeta = SUBREDDITS.find((s) => s.name.toLowerCase() === subreddit.toLowerCase());

  return (
    <div className="min-h-screen bg-white font-manrope text-slate-900">
      <header className="sticky top-0 z-20 border-b border-violet-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <DreyvStar size={12} />
            <span className="text-sm font-semibold">Dreyv Studio · Reddit drafts</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <Link href="/studio" className="hover:text-violet-700">Media</Link>
            <Link href="/studio/case-studies" className="hover:text-violet-700">Case studies</Link>
            <Link href={DREYV_DEV_SURFACE.homepage} className="hover:text-violet-700" target="_blank">
              /developers ↗
            </Link>
          </div>
        </div>
      </header>

      <section className="border-b border-violet-100 bg-violet-50/40">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="text-3xl font-bold tracking-tight">Generate a Reddit draft</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Subreddit-tuned post drafts grounded in the Dreyv developers surface (MCP + REST + 300+ capabilities).
            Drafts are <strong>never auto-posted</strong> — you review, edit, then submit manually from your own Reddit account.
            Links go in the OP&apos;s first comment, not the body.
          </p>

          <form onSubmit={generate} className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Subreddit</span>
              <input
                value={subreddit}
                onChange={(e) => setSubreddit(e.target.value)}
                list="dreyv-subreddits"
                placeholder="ClaudeAI"
                className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
              />
              <datalist id="dreyv-subreddits">
                {SUBREDDITS.map((s) => (
                  <option key={s.name} value={s.name}>{s.note}</option>
                ))}
              </datalist>
              {subMeta && <span className="text-[11px] text-slate-500">r/{subMeta.name} — {subMeta.note}</span>}
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Angle</span>
              <select
                value={angle}
                onChange={(e) => setAngle(e.target.value)}
                className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
              >
                {DREYV_DEV_SURFACE.heroHooks.map((h) => (
                  <option key={h.id} value={h.id}>{h.title}</option>
                ))}
                <option value="custom">Custom angle…</option>
              </select>
            </label>

            {angle === "custom" && (
              <label className="flex flex-col gap-1.5 md:col-span-2">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Custom angle</span>
                <textarea
                  value={customAngle}
                  onChange={(e) => setCustomAngle(e.target.value)}
                  rows={2}
                  placeholder="Describe the angle in 1–2 sentences. Reference the capability or developer surface to lead with."
                  className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
                />
              </label>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Tone</span>
              <div className="flex gap-1.5 rounded-2xl border border-violet-200 bg-white p-1.5">
                {TONES.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => setTone(t.id)}
                    className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                      tone === t.id ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-violet-50"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Length</span>
              <div className="flex gap-1.5 rounded-2xl border border-violet-200 bg-white p-1.5">
                {LENGTHS.map((l) => (
                  <button
                    type="button"
                    key={l.id}
                    onClick={() => setLength(l.id)}
                    className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                      length === l.id ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-violet-50"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </label>

            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-violet-700">Audience focus (optional)</span>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. solo devs shipping Claude tools, treasury operators evaluating MCP"
                className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
              />
            </label>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={loading || !subreddit.trim() || (angle === "custom" && !customAngle.trim())}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                {loading ? "Generating draft…" : "Generate draft"}
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

      {draft && (
        <section className="mx-auto max-w-6xl px-6 py-10">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-6">
              <div className="rounded-3xl border border-violet-100 bg-white p-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-widest text-violet-700">Title</h2>
                  <CopyButton text={draft.titles[0] ?? ""} />
                </div>
                <p className="text-xl font-semibold leading-snug text-slate-900">{draft.titles[0]}</p>
                {draft.titles.length > 1 && (
                  <div className="mt-4">
                    <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Backups</div>
                    <ul className="mt-2 space-y-1.5">
                      {draft.titles.slice(1).map((t, i) => (
                        <li key={i} className="flex items-start justify-between gap-3 text-sm text-slate-700">
                          <span>{t}</span>
                          <CopyButton text={t} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-violet-100 bg-white p-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-widest text-violet-700">Body</h2>
                  <CopyButton text={draft.body} />
                </div>
                <pre className="whitespace-pre-wrap font-manrope text-sm leading-6 text-slate-800">{draft.body}</pre>
              </div>

              <div className="rounded-3xl border border-violet-100 bg-white p-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-widest text-violet-700">First comment (links go here)</h2>
                  <CopyButton text={draft.firstComment} />
                </div>
                <pre className="whitespace-pre-wrap font-manrope text-sm leading-6 text-slate-800">{draft.firstComment}</pre>
              </div>
            </div>

            <aside className="space-y-6">
              <div className="rounded-3xl border border-violet-100 bg-violet-50/60 p-6">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-violet-700">Posting window</h3>
                <p className="mt-2 text-sm text-slate-800">{draft.postingWindow}</p>
              </div>

              <div className="rounded-3xl border border-violet-100 bg-white p-6">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-violet-700">Compliance checklist</h3>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {draft.complianceChecks.map((c, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <DreyvStar size={10} />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-3xl border border-violet-100 bg-white p-6 text-xs text-slate-500">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-violet-700">Reminders</h3>
                <ul className="mt-3 space-y-1.5">
                  <li>· Submit from your own Reddit account.</li>
                  <li>· No UTM params. No URL shorteners.</li>
                  <li>· Reply to early comments within 30 min.</li>
                  <li>· Mark as posted in your own log — this tool does not persist drafts.</li>
                </ul>
              </div>
            </aside>
          </div>
        </section>
      )}
    </div>
  );
}
