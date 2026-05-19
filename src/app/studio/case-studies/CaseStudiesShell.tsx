"use client";

import * as React from "react";
import StudioPasswordGate from "../StudioPasswordGate";
import { CaseStudyReportView } from "@/components/case-study/CaseStudyReportView";
import type { CaseStudyReport } from "@/lib/case-study/builder";
import { Loader2, Search } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import Link from "next/link";

const SUGGESTIONS: { address: string; label: string }[] = [
  { address: "899YG3yk4F66ZgbNWLHriZHTXSKk9e1kvsKEquW7L6Mo", label: "Marinade DAO Realm" },
];

export default function CaseStudiesShell({ unlocked }: { unlocked: boolean }) {
  const [isUnlocked, setIsUnlocked] = React.useState(unlocked);
  const [address, setAddress] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [kind, setKind] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<CaseStudyReport | null>(null);

  if (!isUnlocked) return <StudioPasswordGate onUnlocked={() => setIsUnlocked(true)} />;

  async function run(addr: string, lbl?: string, k?: string) {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const params = new URLSearchParams();
      if (lbl) params.set("label", lbl);
      if (k) params.set("kind", k);
      const r = await fetch(`/api/case-study/${addr.trim()}?${params.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j.error || "Failed to generate");
      } else {
        setReport(j.report);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) return;
    run(address, label || undefined, kind || undefined);
  }

  return (
    <div className="min-h-screen bg-white font-manrope text-slate-900">
      <header className="sticky top-0 z-20 border-b border-violet-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <DreyvStar size={12} />
            <span className="text-sm font-semibold">Dreyv Studio · Case Studies</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <Link href="/studio" className="hover:text-violet-700">Media</Link>
            <Link href="/case" className="hover:text-violet-700" target="_blank">Public /case ↗</Link>
          </div>
        </div>
      </header>

      <section className="border-b border-violet-100 bg-violet-50/40">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="text-3xl font-bold tracking-tight">Generate a case study</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Paste any public Solana address. The same builder that powers <code>/case/[address]</code> runs live — Helius + Jupiter + the in-house yield + audit engine. Preview below, then add to the featured list when ready.
          </p>

          <form onSubmit={onSubmit} className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_140px_auto]">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Solana address (base58)"
              className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm font-mono focus:border-violet-500 focus:outline-none"
            />
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (optional)"
              className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
            >
              <option value="">Kind</option>
              <option value="DAO">DAO</option>
              <option value="Foundation">Foundation</option>
              <option value="Protocol">Protocol</option>
              <option value="Whale">Whale</option>
              <option value="Validator">Validator</option>
            </select>
            <button
              type="submit"
              disabled={loading || !address.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {loading ? "Generating…" : "Generate"}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Try:</span>
            {SUGGESTIONS.map((s) => (
              <button
                key={s.address}
                type="button"
                onClick={() => {
                  setAddress(s.address);
                  setLabel(s.label);
                  setKind("DAO");
                  run(s.address, s.label, "DAO");
                }}
                className="rounded-full border border-violet-200 bg-white px-3 py-1 text-violet-700 hover:border-violet-400"
              >
                {s.label}
              </button>
            ))}
          </div>

          {error && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        </div>
      </section>

      {report && (
        <section>
          <div className="mx-auto max-w-6xl px-6 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-violet-200 bg-white px-4 py-3 text-xs text-slate-600">
              <span>
                Preview · <code className="font-mono text-violet-700">{report.address}</code>
              </span>
              <div className="flex items-center gap-3">
                <Link href={`/case/${report.address}`} target="_blank" className="font-semibold text-violet-700 hover:text-violet-900">
                  Open public page ↗
                </Link>
                <span className="text-slate-400">
                  To publish: add to <code className="font-mono">src/lib/case-study/featured.ts</code>
                </span>
              </div>
            </div>
          </div>
          <CaseStudyReportView report={report} />
        </section>
      )}
    </div>
  );
}
