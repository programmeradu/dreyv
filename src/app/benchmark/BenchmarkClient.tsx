"use client";

/**
 * Benchmark dashboard.
 *
 * Reads SSE from /api/benchmark/run and aggregates per-provider scores live.
 * Final scoreboard ranks providers across 17+ factors:
 *   1. ok rate
 *   2. avg latency
 *   3. p95 latency
 *   4. error count
 *   5. timeout count
 *   6. 4xx/5xx count
 *   7. avg output chars
 *   8. avg prompt tokens
 *   9. avg completion tokens
 *   10. JSON validity (when expected)
 *   11. mustInclude hit rate
 *   12. mustNotInclude violations
 *   13. banned brand-voice word hits
 *   14. demo-figure violations
 *   15. empty response count
 *   16. refusal rate
 *   17. judge: command_understanding
 *   18. judge: accuracy
 *   19. judge: safety
 *   20. judge: brand_voice
 *   21. judge: helpfulness
 *   22. composite (sum of judge dims, normalized 0–100)
 */

import { useCallback, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";

type ProviderId = "lovable" | "groq" | "cloudflare";

interface DeterministicScore {
  includeHits: number;
  includeTotal: number;
  excludeViolations: string[];
  jsonValid?: boolean;
  bannedWordHits: string[];
  demoFigureViolation: boolean;
  empty: boolean;
  refusalDetected: boolean;
  outputChars: number;
}

interface JudgeScore {
  command_understanding: number;
  accuracy: number;
  safety: number;
  brand_voice: number;
  helpfulness: number;
  notes: string;
}

interface ProviderResult {
  ok: boolean;
  latencyMs: number;
  output: string;
  errorMessage?: string;
  promptTokens?: number;
  completionTokens?: number;
  status?: number;
}

interface ScenarioRow {
  index: number;
  scenario: { id: string; category: string; prompt: string; expectedKind: string; rubric: string };
  results: { provider: ProviderId; result: ProviderResult; deterministic: DeterministicScore; judge: JudgeScore | null }[];
}

const PROVIDERS: ProviderId[] = ["lovable", "groq", "cloudflare"];
const PROVIDER_LABEL: Record<ProviderId, string> = {
  lovable: "Lovable AI · gemini-3-flash",
  groq: "Groq · llama-3.3-70b",
  cloudflare: "Cloudflare · llama-3.3-70b-fp8",
};

function p95(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

interface Aggregate {
  total: number;
  ok: number;
  errors: number;
  timeouts: number;
  http4xx: number;
  http5xx: number;
  latencies: number[];
  outputChars: number[];
  promptTokens: number[];
  completionTokens: number[];
  jsonExpected: number;
  jsonValid: number;
  includeHits: number;
  includeTotal: number;
  excludeViolations: number;
  bannedWords: number;
  demoFigureViolations: number;
  empty: number;
  refusals: number;
  judge: { command_understanding: number[]; accuracy: number[]; safety: number[]; brand_voice: number[]; helpfulness: number[] };
}

function emptyAgg(): Aggregate {
  return {
    total: 0, ok: 0, errors: 0, timeouts: 0, http4xx: 0, http5xx: 0,
    latencies: [], outputChars: [], promptTokens: [], completionTokens: [],
    jsonExpected: 0, jsonValid: 0,
    includeHits: 0, includeTotal: 0, excludeViolations: 0,
    bannedWords: 0, demoFigureViolations: 0, empty: 0, refusals: 0,
    judge: { command_understanding: [], accuracy: [], safety: [], brand_voice: [], helpfulness: [] },
  };
}

function aggregateRows(rows: ScenarioRow[]): Record<ProviderId, Aggregate> {
  const out: Record<ProviderId, Aggregate> = {
    lovable: emptyAgg(), groq: emptyAgg(), cloudflare: emptyAgg(),
  };
  for (const row of rows) {
    for (const r of row.results) {
      const a = out[r.provider];
      a.total += 1;
      if (r.result.ok) a.ok += 1;
      else a.errors += 1;
      if ((r.result.errorMessage || "").includes("timeout")) a.timeouts += 1;
      if (r.result.status && r.result.status >= 400 && r.result.status < 500) a.http4xx += 1;
      if (r.result.status && r.result.status >= 500) a.http5xx += 1;
      if (r.result.ok) {
        a.latencies.push(r.result.latencyMs);
        a.outputChars.push(r.deterministic.outputChars);
        if (r.result.promptTokens) a.promptTokens.push(r.result.promptTokens);
        if (r.result.completionTokens) a.completionTokens.push(r.result.completionTokens);
      }
      if (r.deterministic.jsonValid !== undefined) {
        a.jsonExpected += 1;
        if (r.deterministic.jsonValid) a.jsonValid += 1;
      }
      a.includeHits += r.deterministic.includeHits;
      a.includeTotal += r.deterministic.includeTotal;
      a.excludeViolations += r.deterministic.excludeViolations.length;
      a.bannedWords += r.deterministic.bannedWordHits.length;
      if (r.deterministic.demoFigureViolation) a.demoFigureViolations += 1;
      if (r.deterministic.empty) a.empty += 1;
      if (r.deterministic.refusalDetected) a.refusals += 1;
      if (r.judge) {
        a.judge.command_understanding.push(r.judge.command_understanding);
        a.judge.accuracy.push(r.judge.accuracy);
        a.judge.safety.push(r.judge.safety);
        a.judge.brand_voice.push(r.judge.brand_voice);
        a.judge.helpfulness.push(r.judge.helpfulness);
      }
    }
  }
  return out;
}

function compositeScore(a: Aggregate): number {
  // Composite 0–100 weighted: judge (60%), reliability (25%), determinism (15%).
  const judgeAvg =
    (avg(a.judge.command_understanding) +
      avg(a.judge.accuracy) +
      avg(a.judge.safety) +
      avg(a.judge.brand_voice) +
      avg(a.judge.helpfulness)) /
    5; // 1–5
  const judgeNorm = (judgeAvg / 5) * 60;
  const reliability = a.total > 0 ? (a.ok / a.total) * 25 : 0;
  const includeRate = a.includeTotal > 0 ? a.includeHits / a.includeTotal : 1;
  const jsonRate = a.jsonExpected > 0 ? a.jsonValid / a.jsonExpected : 1;
  const violations = a.excludeViolations + a.bannedWords + a.demoFigureViolations + a.empty;
  const violationsPenalty = Math.min(15, violations * 1.5);
  const determinism = (includeRate * 0.5 + jsonRate * 0.5) * 15 - violationsPenalty;
  return Math.max(0, Math.min(100, judgeNorm + reliability + determinism));
}

export default function BenchmarkClient() {
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<ScenarioRow[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);
  const [useJudge, setUseJudge] = useState(true);
  const [activeRow, setActiveRow] = useState<number | null>(null);

  const aggregates = useMemo(() => aggregateRows(rows), [rows]);

  const start = useCallback(async () => {
    setRunning(true);
    setRows([]);
    setProgress({ done: 0, total: limit });
    setError(null);
    setActiveRow(null);

    try {
      const res = await fetch(`/api/benchmark/run?limit=${limit}&judge=${useJudge ? 1 : 0}`, {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok || !res.body) {
        setError(`HTTP ${res.status}`);
        setRunning(false);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() || "";
        for (const evt of events) {
          const evMatch = evt.match(/^event:\s*(\w+)/m);
          const dataMatch = evt.match(/^data:\s*(.+)$/m);
          if (!evMatch || !dataMatch) continue;
          const ev = evMatch[1];
          let data: any;
          try { data = JSON.parse(dataMatch[1]); } catch { continue; }
          if (ev === "start") {
            setProgress({ done: 0, total: data.total });
          } else if (ev === "scenario_done") {
            setRows((r) => [...r, data]);
            setProgress((p) => ({ ...p, done: p.done + 1 }));
          } else if (ev === "end") {
            setRunning(false);
          }
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, [limit, useJudge]);

  function downloadJson() {
    const blob = new Blob([JSON.stringify({ rows, aggregates }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dreyv-benchmark-${new Date().toISOString()}.json`;
    a.click();
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-600">Internal · benchmark</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">CommandBar model stress test</h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-600">
          100 unique scenarios across treasury reads, swaps, simulations, analytics, governance, jailbreaks, and brand-voice traps. Each prompt is sent to all three providers; responses are scored by deterministic heuristics and an LLM judge.
        </p>
      </header>

      <section className="mb-8 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 rounded-2xl border border-violet-200 bg-white px-3 py-2 text-sm">
          <span className="text-slate-600">Scenarios</span>
          <input
            type="number"
            min={1}
            max={100}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(100, Number(e.target.value) || 100)))}
            disabled={running}
            className="w-16 bg-transparent outline-none font-mono"
          />
        </label>
        <label className="flex items-center gap-2 rounded-2xl border border-violet-200 bg-white px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={useJudge}
            onChange={(e) => setUseJudge(e.target.checked)}
            disabled={running}
          />
          <span className="text-slate-600">LLM judge (slower, more thorough)</span>
        </label>
        <button
          onClick={start}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {running ? `Running… ${progress.done}/${progress.total}` : "Run benchmark"}
          <ArrowRight size={14} />
        </button>
        {rows.length > 0 && !running && (
          <button onClick={downloadJson} className="rounded-full border border-violet-200 px-4 py-2 text-sm hover:border-violet-600">
            Download JSON
          </button>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </section>

      {progress.total > 0 && (
        <div className="mb-8 h-1.5 w-full overflow-hidden rounded-full bg-violet-100">
          <div
            className="h-full bg-violet-600 transition-[width] duration-300"
            style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
          />
        </div>
      )}

      {rows.length > 0 && (
        <>
          <Scoreboard aggregates={aggregates} />
          <ScenarioTable rows={rows} onSelect={setActiveRow} />
        </>
      )}

      {activeRow !== null && rows[activeRow] && (
        <RowDetail row={rows[activeRow]} onClose={() => setActiveRow(null)} />
      )}
    </div>
  );
}

function Scoreboard({ aggregates }: { aggregates: Record<ProviderId, Aggregate> }) {
  const composites = PROVIDERS.map((p) => ({ provider: p, score: compositeScore(aggregates[p]) }));
  const winner = composites.reduce((a, b) => (b.score > a.score ? b : a));

  const rows: { label: string; render: (a: Aggregate) => string; lowerIsBetter?: boolean }[] = [
    { label: "Ok rate", render: (a) => a.total ? `${Math.round((a.ok / a.total) * 100)}%` : "—" },
    { label: "Errors", render: (a) => `${a.errors}`, lowerIsBetter: true },
    { label: "Timeouts", render: (a) => `${a.timeouts}`, lowerIsBetter: true },
    { label: "HTTP 4xx", render: (a) => `${a.http4xx}`, lowerIsBetter: true },
    { label: "HTTP 5xx", render: (a) => `${a.http5xx}`, lowerIsBetter: true },
    { label: "Avg latency", render: (a) => `${Math.round(avg(a.latencies))} ms`, lowerIsBetter: true },
    { label: "p95 latency", render: (a) => `${Math.round(p95(a.latencies))} ms`, lowerIsBetter: true },
    { label: "Avg output chars", render: (a) => `${Math.round(avg(a.outputChars))}` },
    { label: "Avg prompt tokens", render: (a) => a.promptTokens.length ? `${Math.round(avg(a.promptTokens))}` : "—" },
    { label: "Avg completion tokens", render: (a) => a.completionTokens.length ? `${Math.round(avg(a.completionTokens))}` : "—" },
    { label: "JSON valid (of expected)", render: (a) => a.jsonExpected ? `${a.jsonValid}/${a.jsonExpected}` : "—" },
    { label: "mustInclude hit rate", render: (a) => a.includeTotal ? `${Math.round((a.includeHits / a.includeTotal) * 100)}%` : "—" },
    { label: "mustNotInclude violations", render: (a) => `${a.excludeViolations}`, lowerIsBetter: true },
    { label: "Banned word hits", render: (a) => `${a.bannedWords}`, lowerIsBetter: true },
    { label: "Demo-figure violations", render: (a) => `${a.demoFigureViolations}`, lowerIsBetter: true },
    { label: "Empty responses", render: (a) => `${a.empty}`, lowerIsBetter: true },
    { label: "Refusal rate", render: (a) => a.total ? `${Math.round((a.refusals / a.total) * 100)}%` : "—" },
    { label: "Judge · command understanding", render: (a) => a.judge.command_understanding.length ? avg(a.judge.command_understanding).toFixed(2) : "—" },
    { label: "Judge · accuracy", render: (a) => a.judge.accuracy.length ? avg(a.judge.accuracy).toFixed(2) : "—" },
    { label: "Judge · safety", render: (a) => a.judge.safety.length ? avg(a.judge.safety).toFixed(2) : "—" },
    { label: "Judge · brand voice", render: (a) => a.judge.brand_voice.length ? avg(a.judge.brand_voice).toFixed(2) : "—" },
    { label: "Judge · helpfulness", render: (a) => a.judge.helpfulness.length ? avg(a.judge.helpfulness).toFixed(2) : "—" },
  ];

  return (
    <section className="mb-12 rounded-3xl border border-violet-100 bg-white p-6">
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {PROVIDERS.map((p) => {
          const score = composites.find((c) => c.provider === p)!.score;
          const isWinner = p === winner.provider && score > 0;
          return (
            <div key={p} className={`rounded-2xl border p-5 ${isWinner ? "border-violet-600" : "border-violet-100"}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-600">{isWinner ? "Leading" : PROVIDER_LABEL[p].split(" · ")[0]}</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{PROVIDER_LABEL[p]}</p>
              <p className="mt-4 text-4xl font-semibold tabular-nums text-slate-900">{score.toFixed(1)}</p>
              <p className="mt-1 text-xs text-slate-500">composite / 100</p>
            </div>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-violet-100 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-4 font-medium">Metric</th>
              {PROVIDERS.map((p) => <th key={p} className="py-2 pr-4 font-medium">{p}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const values = PROVIDERS.map((p) => m.render(aggregates[p]));
              return (
                <tr key={m.label} className="border-b border-violet-50">
                  <td className="py-2 pr-4 text-slate-600">{m.label}</td>
                  {values.map((v, i) => (
                    <td key={i} className="py-2 pr-4 font-mono tabular-nums text-slate-900">{v}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ScenarioTable({ rows, onSelect }: { rows: ScenarioRow[]; onSelect: (i: number) => void }) {
  return (
    <section className="rounded-3xl border border-violet-100 bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">Per-scenario results</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-violet-100 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-3 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">ID</th>
              <th className="py-2 pr-3 font-medium">Category</th>
              <th className="py-2 pr-3 font-medium">Prompt</th>
              {PROVIDERS.map((p) => <th key={p} className="py-2 pr-3 font-medium">{p}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.scenario.id} className="border-b border-violet-50 hover:bg-violet-50/50 cursor-pointer" onClick={() => onSelect(row.index)}>
                <td className="py-2 pr-3 font-mono text-slate-500">{row.index + 1}</td>
                <td className="py-2 pr-3 font-mono text-slate-700">{row.scenario.id}</td>
                <td className="py-2 pr-3 text-slate-600">{row.scenario.category}</td>
                <td className="py-2 pr-3 max-w-md truncate text-slate-900">{row.scenario.prompt || "(empty)"}</td>
                {PROVIDERS.map((p) => {
                  const r = row.results.find((x) => x.provider === p);
                  if (!r) return <td key={p} className="py-2 pr-3 text-slate-400">—</td>;
                  if (!r.result.ok) {
                    return <td key={p} className="py-2 pr-3 text-red-600 font-mono text-xs">err {r.result.status || ""}</td>;
                  }
                  const j = r.judge;
                  const sum = j ? (j.command_understanding + j.accuracy + j.safety + j.brand_voice + j.helpfulness) : null;
                  return (
                    <td key={p} className="py-2 pr-3 font-mono tabular-nums">
                      <span className="text-slate-900">{sum != null ? sum : "·"}</span>
                      <span className="text-slate-400 ml-2">{r.result.latencyMs}ms</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RowDetail({ row, onClose }: { row: ScenarioRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div className="max-w-4xl w-full max-h-[85vh] overflow-y-auto rounded-3xl border border-violet-100 bg-white p-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs font-mono text-violet-600">{row.scenario.id} · {row.scenario.category}</p>
            <p className="mt-1 text-lg font-medium text-slate-900">{row.scenario.prompt || "(empty)"}</p>
            <p className="mt-1 text-xs text-slate-500">Expected: {row.scenario.expectedKind} — {row.scenario.rubric}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 text-2xl leading-none">×</button>
        </div>

        <div className="space-y-4">
          {row.results.map((r) => (
            <div key={r.provider} className="rounded-2xl border border-violet-100 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-slate-900">{PROVIDER_LABEL[r.provider]}</p>
                <p className="text-xs font-mono text-slate-500">
                  {r.result.ok ? `${r.result.latencyMs}ms` : `err ${r.result.status || ""}`}
                  {r.judge && <span className="ml-3">judge: u{r.judge.command_understanding} a{r.judge.accuracy} s{r.judge.safety} v{r.judge.brand_voice} h{r.judge.helpfulness}</span>}
                </p>
              </div>
              {!r.result.ok && <p className="text-xs text-red-600">{r.result.errorMessage}</p>}
              {r.result.ok && (
                <pre className="whitespace-pre-wrap text-sm text-slate-700 font-sans">{r.result.output || "(empty)"}</pre>
              )}
              {r.judge?.notes && <p className="mt-2 text-xs italic text-slate-500">judge: {r.judge.notes}</p>}
              {(r.deterministic.bannedWordHits.length > 0 || r.deterministic.demoFigureViolation || r.deterministic.excludeViolations.length > 0) && (
                <div className="mt-2 text-xs text-red-600">
                  {r.deterministic.bannedWordHits.length > 0 && <span className="mr-3">banned: {r.deterministic.bannedWordHits.join(", ")}</span>}
                  {r.deterministic.demoFigureViolation && <span className="mr-3">demo-figure violation</span>}
                  {r.deterministic.excludeViolations.length > 0 && <span>mustNotInclude: {r.deterministic.excludeViolations.join(", ")}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
