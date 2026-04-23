/**
 * /app/inbox — proposal & sub-agent inbox.
 *
 * Surfaces every `agent.proposal.created` / `agent.alert.raised` the
 * brain pipeline has emitted, plus the active sub-agent roster spawned
 * by the reflector. Light theme, solid violet accents per brand rules.
 */
"use client";

import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, ShieldAlert, Check, X, Bot } from "lucide-react";

type Proposal = {
  id: string;
  kind: "proposal" | "alert";
  title: string;
  thesis: string;
  actions: Array<{ op: string; rationale?: string; params?: Record<string, unknown> }>;
  riskNotes: string[];
  confidence: string;
  horizon: string;
  model: string;
  tags: string[];
  status: string;
  createdAt: string;
};

type SubAgent = {
  id: string;
  name: string;
  goal: string;
  capabilities: string[];
  parent: string;
  status: string;
  ttlMinutes: number;
  expiresAt: string;
  createdAt: string;
};

export default function InboxPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [subagents, setSubagents] = useState<SubAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([
        fetch("/api/inbox/proposals", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/inbox/subagents", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setProposals(p?.proposals ?? []);
      setSubagents(s?.subagents ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (id: string, status: "acted" | "dismissed") => {
    setBusyId(id);
    try {
      await fetch("/api/inbox/proposals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      setProposals((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="min-h-screen bg-white text-neutral-900 font-[Manrope,sans-serif]">
      {/* Ambient violet glow */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-violet-300/30 blur-3xl" />
        <div className="absolute top-[40%] -right-32 h-[380px] w-[520px] rounded-full bg-violet-400/20 blur-3xl" />
      </div>

      <section className="mx-auto max-w-5xl px-6 pt-16 pb-10">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Brain Inbox</h1>
            <p className="text-sm text-neutral-500">
              Proposals and alerts from the autonomous agent fabric. Triage → deep
              reasoning → here.
            </p>
          </div>
          <Button
            variant="outline"
            className="ml-auto border-violet-200 text-violet-700 hover:bg-violet-50"
            onClick={refresh}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-700">
          <ShieldAlert className="h-4 w-4 text-violet-600" />
          Open proposals & alerts
          <span className="ml-1 text-neutral-400">({proposals.length})</span>
        </div>

        {loading && proposals.length === 0 ? (
          <Card className="border-violet-100 bg-white/70 p-8 text-center text-sm text-neutral-500">
            Loading…
          </Card>
        ) : proposals.length === 0 ? (
          <Card className="border-violet-100 bg-white/70 p-8 text-center text-sm text-neutral-500">
            No open items. The fabric is watching — anything escalated will land here.
          </Card>
        ) : (
          <div className="space-y-3">
            {proposals.map((p) => (
              <Card
                key={p.id}
                className="border-violet-100 bg-white p-5 shadow-sm transition hover:border-violet-300"
              >
                <div className="flex items-start gap-3">
                  <Badge
                    className={
                      p.kind === "proposal"
                        ? "bg-violet-600 text-white hover:bg-violet-600"
                        : "bg-amber-500 text-white hover:bg-amber-500"
                    }
                  >
                    {p.kind}
                  </Badge>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold">{p.title}</h3>
                      <span className="ml-auto text-xs text-neutral-400">
                        conf {Number(p.confidence).toFixed(2)} • {p.horizon} • {p.model}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-neutral-600">{p.thesis}</p>
                    {p.actions?.length > 0 && (
                      <ul className="mt-3 space-y-1">
                        {p.actions.slice(0, 3).map((a, i) => (
                          <li
                            key={i}
                            className="rounded-md border border-violet-100 bg-violet-50/40 px-3 py-2 text-xs text-neutral-700"
                          >
                            <span className="font-mono text-violet-700">{a.op}</span>
                            {a.rationale ? <> — {a.rationale}</> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    {p.riskNotes?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {p.riskNotes.slice(0, 4).map((r, i) => (
                          <span
                            key={i}
                            className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-4 flex gap-2">
                      <Button
                        size="sm"
                        className="bg-violet-600 text-white hover:bg-violet-700"
                        disabled={busyId === p.id}
                        onClick={() => act(p.id, "acted")}
                      >
                        <Check className="mr-1 h-4 w-4" /> Mark acted
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-violet-200 text-neutral-700 hover:bg-violet-50"
                        disabled={busyId === p.id}
                        onClick={() => act(p.id, "dismissed")}
                      >
                        <X className="mr-1 h-4 w-4" /> Dismiss
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        <div className="mt-12 mb-3 flex items-center gap-2 text-sm font-medium text-neutral-700">
          <Bot className="h-4 w-4 text-violet-600" />
          Active sub-agents
          <span className="ml-1 text-neutral-400">({subagents.length})</span>
        </div>
        {subagents.length === 0 ? (
          <Card className="border-violet-100 bg-white/70 p-6 text-center text-sm text-neutral-500">
            No sub-agents spawned yet. The reflector spawns them from
            high-confidence deep proposals.
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {subagents.map((s) => (
              <Card key={s.id} className="border-violet-100 bg-white p-4">
                <div className="flex items-center gap-2">
                  <Badge className="bg-violet-600 text-white hover:bg-violet-600">
                    {s.parent}
                  </Badge>
                  <h4 className="text-sm font-semibold">{s.name}</h4>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-neutral-600">{s.goal}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.capabilities?.map((c) => (
                    <span
                      key={c}
                      className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] text-violet-700"
                    >
                      {c}
                    </span>
                  ))}
                </div>
                <div className="mt-2 text-[11px] text-neutral-400">
                  TTL {s.ttlMinutes}m • expires{" "}
                  {new Date(s.expiresAt).toLocaleString()}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
