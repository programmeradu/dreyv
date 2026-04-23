/**
 * /app/inbox — proposal & sub-agent inbox + treasury watcher manager.
 *
 * Wallet-scoped (Phase 5): when a Solana wallet is connected we pass
 * `?wallet=<pubkey>` to the inbox APIs so users only see proposals/alerts
 * surfaced for their treasury. Without a wallet we show the workspace-wide
 * (operator) feed for transparency / debugging.
 *
 * Light theme, solid violet accents per brand rules.
 */
"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { NotificationBell } from "@/components/NotificationBell";
import { CollaborativeHeader } from "@/components/CollaborativeHeader";
import { WalletButton } from "@/components/WalletButton";
import { useWallet } from "@solana/wallet-adapter-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useTransactionExecutor } from "@/lib/hooks/useTransactionExecutor";
import { pollConfirmation } from "@/lib/solana/poll-confirmation";
import { Connection } from "@solana/web3.js";
import { toast } from "sonner";
import {
  Loader2,
  Check,
  X,
  Plus,
  Trash2,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import glyphBrand from "@/assets/notif/glyph-brand.png";
import glyphAgent from "@/assets/notif/glyph-agent.png";
import glyphSecurity from "@/assets/notif/glyph-security.png";
import glyphPurchase from "@/assets/notif/glyph-purchase.png";
import glyphSystem from "@/assets/notif/glyph-system.png";

type TxInstruction = {
  op: string;
  params: Record<string, unknown>;
  rationale?: string;
};

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

type Watcher = {
  id: string;
  chain: string;
  address: string;
  label: string | null;
  active: boolean;
  lastScanAt: string | null;
};

type TxProposal = {
  id: string;
  proposalId: string | null;
  kind: string;
  summary: string;
  status: string;
  riskLevel: string;
  routing: string;
  estimatedFeeSol: string | null;
  signature: string | null;
  errorMessage: string | null;
  createdAt: string;
  expiresAt: string | null;
  unsignedTx?: string | null;
  instructions?: TxInstruction[] | null;
};

const CHAINS = ["solana", "ethereum", "base", "arbitrum", "polygon", "bsc"] as const;

export default function InboxPage() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const executor = useTransactionExecutor();

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [subagents, setSubagents] = useState<SubAgent[]>([]);
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [txProposals, setTxProposals] = useState<TxProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Watcher form state
  const [chain, setChain] = useState<string>("solana");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const q = wallet ? `?wallet=${wallet}` : "";
      const [p, s, w, tx] = await Promise.all([
        fetch(`/api/inbox/proposals${q}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/inbox/subagents${q}`, { cache: "no-store" }).then((r) => r.json()),
        wallet
          ? fetch(`/api/inbox/watchers?wallet=${wallet}`, { cache: "no-store" }).then((r) => r.json())
          : Promise.resolve({ watchers: [] }),
        fetch(`/api/inbox/tx-proposals${q}`, { cache: "no-store" }).then((r) => r.json()),
      ]);
      setProposals(p?.proposals ?? []);
      setSubagents(s?.subagents ?? []);
      setWatchers(w?.watchers ?? []);
      setTxProposals(tx?.txProposals ?? []);
    } finally {
      setLoading(false);
    }
  }, [wallet]);

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

  const addWatcher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet || !address) return;
    setAdding(true);
    try {
      await fetch("/api/inbox/watchers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet, chain, address, label: label || undefined }),
      });
      setAddress("");
      setLabel("");
      await refresh();
    } finally {
      setAdding(false);
    }
  };

  const removeWatcher = async (id: string) => {
    await fetch(`/api/inbox/watchers?id=${id}`, { method: "DELETE" });
    setWatchers((prev) => prev.filter((w) => w.id !== id));
  };

  const patchTx = async (
    id: string,
    action: "approve" | "reject" | "submitted" | "confirmed" | "failed",
    extra: { signature?: string; errorMessage?: string } = {}
  ) => {
    return fetch("/api/inbox/tx-proposals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, ...extra }),
    });
  };

  const dispatchInstruction = async (
    ix: TxInstruction
  ): Promise<{ success: boolean; signature?: string; error?: string }> => {
    const p = ix.params || {};
    switch (ix.op) {
      case "swap": {
        const inputToken = String(p.inputToken ?? p.inMint ?? "");
        const outputToken = String(p.outputToken ?? p.outMint ?? "");
        const amount = Number(p.amount ?? 0);
        const slippageBps = p.slippageBps ? Number(p.slippageBps) : undefined;
        if (!inputToken || !outputToken || !amount) {
          return { success: false, error: "missing swap params" };
        }
        return executor.executeSwap({ inputToken, outputToken, amount, slippageBps });
      }
      case "transfer": {
        const recipient = String(p.recipient ?? p.to ?? "");
        const token = String(p.token ?? "SOL");
        const amount = Number(p.amount ?? 0);
        if (!recipient || !amount) return { success: false, error: "missing transfer params" };
        return executor.executeTransfer({ recipient, token, amount });
      }
      default:
        // For stake/unstake/deposit_yield/withdraw/rebalance — no client builder yet.
        // Fall back to a memo-only proposal so the action is recorded on-chain via multisig
        // or surfaced for manual handling.
        return executor.createProposal(`${ix.op}: ${JSON.stringify(p).slice(0, 160)}`);
    }
  };

  const actTx = async (id: string, action: "approve" | "reject") => {
    setBusyId(id);
    try {
      if (action === "reject") {
        await patchTx(id, "reject");
        setTxProposals((prev) => prev.filter((t) => t.id !== id));
        return;
      }

      const tx = txProposals.find((t) => t.id === id);
      if (!tx) return;

      if (!executor.isWalletConnected && !executor.isMultisig) {
        toast.error("Connect a wallet to approve transactions");
        return;
      }

      // 1) Mark approved server-side (intent recorded before signing)
      await patchTx(id, "approve");

      // 2) Build/sign/submit on the wallet side
      let result: { success: boolean; signature?: string; proposalKey?: string; error?: string };
      if (tx.unsignedTx) {
        result = await executor.executeRawTransaction(tx.unsignedTx);
      } else {
        const ix = tx.instructions?.[0];
        if (!ix) {
          await patchTx(id, "failed", { errorMessage: "no instructions" });
          toast.error("Proposal has no executable instructions");
          return;
        }
        result = await dispatchInstruction(ix);
      }

      // 3) Patch back result
      if (result.success) {
        const sig = result.signature ?? result.proposalKey;
        await patchTx(id, "submitted", { signature: sig });

        // 4) Re-verify on-chain (only for real Solana signatures, not multisig proposalKeys)
        if (result.signature) {
          const rpc =
            process.env.NEXT_PUBLIC_SOLANA_RPC ||
            process.env.NEXT_PUBLIC_HELIUS_RPC ||
            "https://api.mainnet-beta.solana.com";
          const conn = new Connection(rpc, "confirmed");
          const verdict = await pollConfirmation(conn, result.signature, { maxWaitMs: 60_000 });
          if (verdict.confirmed) {
            await patchTx(id, "confirmed", { signature: sig });
            toast.success(`Confirmed ${sig!.slice(0, 8)}…`);
            setTxProposals((prev) => prev.filter((t) => t.id !== id));
          } else {
            await patchTx(id, "failed", {
              signature: sig,
              errorMessage: `confirmation ${verdict.error ?? "failed"}`,
            });
            toast.error(`On-chain ${verdict.error ?? "failure"}`);
            await refresh();
          }
        } else {
          // Multisig proposal — no signature to poll, treat submission as terminal
          await patchTx(id, "confirmed", { signature: sig });
          toast.success(`Multisig proposal ${sig ? `${sig.slice(0, 8)}…` : "queued"}`);
          setTxProposals((prev) => prev.filter((t) => t.id !== id));
        }
      } else {
        await patchTx(id, "failed", { errorMessage: result.error?.slice(0, 400) });
        toast.error(result.error ?? "Transaction failed");
        // Refresh to show error state instead of dropping the row
        await refresh();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      await patchTx(id, "failed", { errorMessage: msg.slice(0, 400) });
      toast.error(msg);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  type TabKey = "pending" | "proposals" | "subagents" | "watchers";
  const [tab, setTab] = useState<TabKey>("pending");

  const TABS: { key: TabKey; label: string; count: number; glyph: any }[] = [
    { key: "pending", label: "Pending", count: txProposals.length, glyph: glyphPurchase },
    { key: "proposals", label: "Proposals", count: proposals.length, glyph: glyphSecurity },
    { key: "subagents", label: "Sub-agents", count: subagents.length, glyph: glyphAgent },
    { key: "watchers", label: "Watchers", count: watchers.length, glyph: glyphSystem },
  ];

  const sectionEmpty = (msg: string) => (
    <div className="rounded-xl border border-dashed border-violet-100 bg-white/60 px-5 py-8 text-center text-[12.5px] text-neutral-500">
      {msg}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-screen bg-background overflow-hidden relative font-[Manrope,sans-serif]">
      {/* ─── Universal app header ───────────────────────── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-background/50 backdrop-blur-md z-10 shadow-sm shrink-0">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--dashboard-accent)]" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-70">
              dreyv // Command workspace
            </span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold tracking-tight text-foreground uppercase">Inbox</h1>
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
              HITL
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <NotificationBell />
          <button
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-700 hover:bg-violet-50 transition-colors disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </button>

          <Suspense fallback={<div className="h-8 w-24 bg-muted animate-pulse rounded-full" />}>
            <CollaborativeHeader />
          </Suspense>

          <div className="w-px h-6 bg-border mx-1" />

          <WalletButton />
        </div>
      </header>

      {/* Ambient violet glow */}
      <div className="pointer-events-none absolute inset-x-0 top-16 -z-10 overflow-hidden h-[400px]">
        <div className="absolute -top-32 left-1/2 h-[340px] w-[680px] -translate-x-1/2 rounded-full bg-violet-300/20 blur-3xl" />
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <section className="mx-auto max-w-4xl px-6 pt-6 pb-4">
          {/* Subtitle */}
          <p className="text-[12.5px] text-muted-foreground mb-4">
            {wallet
              ? `Scoped to ${wallet.slice(0, 4)}…${wallet.slice(-4)} — connect a different wallet to switch.`
              : "Workspace-wide view. Connect a wallet to scope to your treasury."}
          </p>

          {/* ─── Tab nav ────────────────────────────────── */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin border-b border-violet-100 pb-0">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`group relative inline-flex items-center gap-2 rounded-t-lg px-3 py-2 text-[12.5px] font-semibold transition-colors whitespace-nowrap ${
                    active
                      ? "bg-violet-600 text-white shadow-sm shadow-violet-600/20"
                      : "text-neutral-600 hover:bg-violet-50 hover:text-violet-700"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={typeof t.glyph === "string" ? t.glyph : (t.glyph as any).src}
                    alt=""
                    aria-hidden
                    className={`size-4 object-contain ${active ? "" : "opacity-80"}`}
                  />
                  {t.label}
                  <span
                    className={`text-[10.5px] font-bold leading-none rounded-full px-1.5 py-px tabular-nums ${
                      active
                        ? "bg-white/20 text-white"
                        : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

      {/* ─── Active tab content ─────────────────────────── */}
      <section className="mx-auto max-w-4xl px-6 pb-16 space-y-3">
        {tab === "pending" && (
          <>
            {txProposals.length === 0
              ? sectionEmpty(
                  "No transactions queued. High-confidence proposals (≥75%) auto-queue here for your approval — nothing signs without you.",
                )
              : txProposals.map((t) => (
                  <article
                    key={t.id}
                    className="rounded-xl border border-violet-100 bg-white p-4 shadow-[0_2px_10px_-4px_rgba(124,58,237,0.08)] transition hover:border-violet-300"
                  >
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-6 items-center rounded-full bg-violet-600 px-2 text-[10px] font-bold uppercase tracking-wider text-white">
                        {t.kind}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2">
                          <h4 className="text-[13.5px] font-semibold text-neutral-900 leading-snug flex-1">
                            {t.summary}
                          </h4>
                          <span className="shrink-0 text-[10.5px] text-neutral-400 tabular-nums pt-0.5">
                            {t.routing} · risk {t.riskLevel}
                            {t.estimatedFeeSol
                              ? ` · ~◎${Number(t.estimatedFeeSol).toFixed(6)}`
                              : ""}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-neutral-500">
                          queued {new Date(t.createdAt).toLocaleTimeString()}
                          {t.expiresAt
                            ? ` · expires ${new Date(t.expiresAt).toLocaleTimeString()}`
                            : ""}
                        </div>
                        {t.errorMessage && (
                          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                            {t.errorMessage}
                          </div>
                        )}
                        <div className="mt-3 flex gap-2">
                          <button
                            disabled={busyId === t.id}
                            onClick={() => actTx(t.id, "approve")}
                            className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-700 transition-colors disabled:opacity-60 shadow-sm shadow-violet-600/20"
                          >
                            <Check className="h-3.5 w-3.5" /> Approve
                          </button>
                          <button
                            disabled={busyId === t.id}
                            onClick={() => actTx(t.id, "reject")}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-60"
                          >
                            <X className="h-3.5 w-3.5" /> Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
          </>
        )}

        {tab === "proposals" && (
          <>
            {loading && proposals.length === 0
              ? sectionEmpty("Loading…")
              : proposals.length === 0
                ? sectionEmpty(
                    "No open items. The fabric is watching — anything escalated will land here.",
                  )
                : proposals.map((p) => (
                    <article
                      key={p.id}
                      className="rounded-xl border border-violet-100 bg-white p-4 shadow-[0_2px_10px_-4px_rgba(124,58,237,0.08)] transition hover:border-violet-300"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`inline-flex h-6 items-center rounded-full px-2 text-[10px] font-bold uppercase tracking-wider text-white ${
                            p.kind === "proposal" ? "bg-violet-600" : "bg-amber-500"
                          }`}
                        >
                          {p.kind}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start gap-2">
                            <h3 className="text-[13.5px] font-semibold text-neutral-900 leading-snug flex-1">
                              {p.title}
                            </h3>
                            <span className="shrink-0 text-[10.5px] text-neutral-400 tabular-nums pt-0.5">
                              conf {Number(p.confidence).toFixed(2)} · {p.horizon} · {p.model}
                            </span>
                          </div>
                          <p className="mt-1 text-[12.5px] text-neutral-600 leading-snug">
                            {p.thesis}
                          </p>
                          {p.actions?.length > 0 && (
                            <ul className="mt-2.5 space-y-1">
                              {p.actions.slice(0, 3).map((a, i) => (
                                <li
                                  key={i}
                                  className="flex items-start gap-2 rounded-md border border-violet-100 bg-violet-50/40 px-2.5 py-1.5 text-[11.5px] text-neutral-700"
                                >
                                  <ChevronRight className="h-3 w-3 text-violet-500 mt-0.5 shrink-0" />
                                  <span>
                                    <span className="font-mono font-semibold text-violet-700">
                                      {a.op}
                                    </span>
                                    {a.rationale ? (
                                      <span className="text-neutral-500"> — {a.rationale}</span>
                                    ) : null}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {p.riskNotes?.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {p.riskNotes.slice(0, 4).map((r, i) => (
                                <span
                                  key={i}
                                  className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] text-amber-700"
                                >
                                  {r}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="mt-3 flex gap-2">
                            <button
                              disabled={busyId === p.id}
                              onClick={() => act(p.id, "acted")}
                              className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-700 transition-colors disabled:opacity-60 shadow-sm shadow-violet-600/20"
                            >
                              <Check className="h-3.5 w-3.5" /> Mark acted
                            </button>
                            <button
                              disabled={busyId === p.id}
                              onClick={() => act(p.id, "dismissed")}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-60"
                            >
                              <X className="h-3.5 w-3.5" /> Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
          </>
        )}

        {tab === "subagents" && (
          <>
            {subagents.length === 0
              ? sectionEmpty(
                  "No sub-agents spawned yet. The reflector spawns them from high-confidence deep proposals.",
                )
              : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {subagents.map((s) => (
                    <article
                      key={s.id}
                      className="rounded-xl border border-violet-100 bg-white p-4 shadow-[0_2px_10px_-4px_rgba(124,58,237,0.08)]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-5 items-center rounded-full bg-violet-600 px-2 text-[10px] font-bold uppercase tracking-wider text-white">
                          {s.parent}
                        </span>
                        <h4 className="text-[13px] font-semibold text-neutral-900 truncate">
                          {s.name}
                        </h4>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12px] text-neutral-600 leading-snug">
                        {s.goal}
                      </p>
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
                      <div className="mt-2 text-[10.5px] text-neutral-400">
                        TTL {s.ttlMinutes}m · expires {new Date(s.expiresAt).toLocaleString()}
                      </div>
                    </article>
                  ))}
                </div>
              )}
          </>
        )}

        {tab === "watchers" && (
          <>
            {!wallet ? (
              sectionEmpty("Connect a wallet to manage treasury watchers.")
            ) : (
              <div className="rounded-xl border border-violet-100 bg-white p-4">
                <form onSubmit={addWatcher} className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col">
                    <label className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500">
                      Chain
                    </label>
                    <select
                      value={chain}
                      onChange={(e) => setChain(e.target.value)}
                      className="h-9 rounded-md border border-violet-200 bg-white px-2 text-[12.5px]"
                    >
                      {CHAINS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex min-w-[220px] flex-1 flex-col">
                    <label className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500">
                      Address
                    </label>
                    <Input
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="0x… or Solana pubkey"
                      className="h-9 border-violet-200 text-[12.5px]"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500">
                      Label
                    </label>
                    <Input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="optional"
                      className="h-9 border-violet-200 text-[12.5px]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={adding || !address}
                    className="inline-flex h-9 items-center gap-1 rounded-lg bg-violet-600 px-3 text-[12px] font-semibold text-white hover:bg-violet-700 transition-colors disabled:opacity-60"
                  >
                    <Plus className="h-3.5 w-3.5" /> Watch
                  </button>
                </form>

                {watchers.length > 0 && (
                  <ul className="mt-3 divide-y divide-violet-100">
                    {watchers.map((w) => (
                      <li
                        key={w.id}
                        className="flex items-center gap-3 py-2 text-[12.5px]"
                      >
                        <span className="inline-flex h-5 items-center rounded-full bg-violet-600 px-2 text-[10px] font-bold uppercase tracking-wider text-white">
                          {w.chain}
                        </span>
                        <span className="font-mono text-[11px] text-neutral-700">
                          {w.address.slice(0, 6)}…{w.address.slice(-6)}
                        </span>
                        {w.label && (
                          <span className="text-neutral-500 truncate">— {w.label}</span>
                        )}
                        <span className="ml-auto text-[10.5px] text-neutral-400 shrink-0">
                          {w.lastScanAt
                            ? `last scan ${new Date(w.lastScanAt).toLocaleTimeString()}`
                            : "never scanned"}
                        </span>
                        <button
                          onClick={() => removeWatcher(w.id)}
                          className="rounded-md p-1.5 text-neutral-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                          aria-label="Remove watcher"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </section>
      </div>
    </div>
  );
}
