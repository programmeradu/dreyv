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

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useTransactionExecutor } from "@/lib/hooks/useTransactionExecutor";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  ShieldAlert,
  Check,
  X,
  Bot,
  Eye,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";

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
        // Optimistic confirmed — wallet executor already awaits confirmation
        await patchTx(id, "confirmed", { signature: sig });
        toast.success(`Transaction ${sig ? `${sig.slice(0, 8)}…` : "submitted"}`);
        setTxProposals((prev) => prev.filter((t) => t.id !== id));
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

  return (
    <main className="relative min-h-screen bg-white text-neutral-900 font-[Manrope,sans-serif]">
      {/* Ambient violet glow */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-violet-300/30 blur-3xl" />
        <div className="absolute top-[40%] -right-32 h-[380px] w-[520px] rounded-full bg-violet-400/20 blur-3xl" />
      </div>

      <section className="mx-auto max-w-5xl px-6 pt-16 pb-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Brain Inbox</h1>
            <p className="text-sm text-neutral-500">
              {wallet
                ? `Scoped to ${wallet.slice(0, 4)}…${wallet.slice(-4)} — connect a different wallet to switch.`
                : "Workspace-wide view. Connect a wallet to scope to your treasury."}
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

      {/* Treasury watchers */}
      {wallet && (
        <section className="mx-auto max-w-5xl px-6 pb-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-700">
            <Eye className="h-4 w-4 text-violet-600" />
            Treasury watchers
            <span className="ml-1 text-neutral-400">({watchers.length})</span>
          </div>
          <Card className="border-violet-100 bg-white p-4">
            <form onSubmit={addWatcher} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col">
                <label className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">Chain</label>
                <select
                  value={chain}
                  onChange={(e) => setChain(e.target.value)}
                  className="h-9 rounded-md border border-violet-200 bg-white px-2 text-sm"
                >
                  {CHAINS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex min-w-[260px] flex-1 flex-col">
                <label className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">Address</label>
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="0x… or Solana pubkey"
                  className="border-violet-200"
                />
              </div>
              <div className="flex flex-col">
                <label className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">Label</label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="optional"
                  className="border-violet-200"
                />
              </div>
              <Button
                type="submit"
                disabled={adding || !address}
                className="bg-violet-600 text-white hover:bg-violet-700"
              >
                <Plus className="mr-1 h-4 w-4" /> Watch
              </Button>
            </form>

            {watchers.length > 0 && (
              <ul className="mt-4 divide-y divide-violet-100">
                {watchers.map((w) => (
                  <li key={w.id} className="flex items-center gap-3 py-2 text-sm">
                    <Badge className="bg-violet-600 text-white hover:bg-violet-600">{w.chain}</Badge>
                    <span className="font-mono text-xs text-neutral-700">
                      {w.address.slice(0, 6)}…{w.address.slice(-6)}
                    </span>
                    {w.label && <span className="text-neutral-500">— {w.label}</span>}
                    <span className="ml-auto text-[11px] text-neutral-400">
                      {w.lastScanAt ? `last scan ${new Date(w.lastScanAt).toLocaleTimeString()}` : "never scanned"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeWatcher(w.id)}
                      className="text-neutral-500 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      {/* Pending HITL transactions (Phase 6) */}
      <section className="mx-auto max-w-5xl px-6 pb-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-700">
          <Zap className="h-4 w-4 text-violet-600" />
          Pending transactions
          <span className="ml-1 text-neutral-400">({txProposals.length})</span>
          <span className="ml-2 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
            HITL gated
          </span>
        </div>
        {txProposals.length === 0 ? (
          <Card className="border-violet-100 bg-white/70 p-6 text-center text-sm text-neutral-500">
            No transactions queued. High-confidence proposals (≥75%) auto-queue
            here for your approval — nothing signs without you.
          </Card>
        ) : (
          <div className="space-y-3">
            {txProposals.map((t) => (
              <Card
                key={t.id}
                className="border-violet-200 bg-white p-4 shadow-sm transition hover:border-violet-400"
              >
                <div className="flex items-start gap-3">
                  <Badge className="bg-violet-600 text-white hover:bg-violet-600">{t.kind}</Badge>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold">{t.summary}</h4>
                      <span className="ml-auto text-[11px] text-neutral-400">
                        {t.routing} • risk {t.riskLevel}
                        {t.estimatedFeeSol ? ` • ~◎${Number(t.estimatedFeeSol).toFixed(6)}` : ""}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-neutral-500">
                      queued {new Date(t.createdAt).toLocaleTimeString()}
                      {t.expiresAt ? ` • expires ${new Date(t.expiresAt).toLocaleTimeString()}` : ""}
                    </div>
                    {t.errorMessage && (
                      <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                        {t.errorMessage}
                      </div>
                    )}
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        className="bg-violet-600 text-white hover:bg-violet-700"
                        disabled={busyId === t.id}
                        onClick={() => actTx(t.id, "approve")}
                      >
                        <Check className="mr-1 h-4 w-4" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-violet-200 text-neutral-700 hover:bg-violet-50"
                        disabled={busyId === t.id}
                        onClick={() => actTx(t.id, "reject")}
                      >
                        <X className="mr-1 h-4 w-4" /> Reject
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Proposals */}
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
