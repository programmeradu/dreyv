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

import { useEffect, useState, useCallback, Suspense, Fragment } from "react";
import { NotificationBell } from "@/components/NotificationBell";
import { CollaborativeHeader } from "@/components/CollaborativeHeader";
import { WalletButton } from "@/components/WalletButton";
import { useWallet, useConnection } from "@/lib/wallet/compat";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useTransactionExecutor } from "@/lib/hooks/useTransactionExecutor";
import { pollConfirmation } from "@/lib/solana/poll-confirmation";
import { buildJitoTipTx, pollJitoBundleStatus } from "@/lib/solana/jito-bundle";
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
  ChevronDown,
  Inbox as InboxIcon,
  CheckCircle2,
  Radio,
  Bot,
  Eye,
} from "lucide-react";
import { useDeclareFocus } from "@/lib/commandbar/focus-context";
import { classifyPlan, formatUsd, relTime } from "./_components/kind";
import { DeliverableView, type DeliverablePayload } from "./_components/DeliverableView";

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

type CommandApproval = {
  id: string;
  commandId: string;
  walletAddress: string | null;
  status: string;
  reason: string;
  riskScore: string | number | null;
  estimatedValueUsd: string | number | null;
  createdAt: string;
  expiresAt: string | null;
  intent: { rawText?: string; goal?: string } | null;
  plan: { rationale?: string; steps?: Array<{ capabilityId: string }> } | null;
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
  const { publicKey, signAllTransactions, signTransaction } = useWallet();
  const { connection } = useConnection();
  const wallet = publicKey?.toBase58() ?? null;
  const executor = useTransactionExecutor();

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [subagents, setSubagents] = useState<SubAgent[]>([]);
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [txProposals, setTxProposals] = useState<TxProposal[]>([]);
  const [commandApprovals, setCommandApprovals] = useState<CommandApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useDeclareFocus(
    { scope: "inbox.queue", label: "Agent inbox", data: { wallet, proposals: proposals.length, txProposals: txProposals.length, commandApprovals: commandApprovals.length, watchers: watchers.length, subagents: subagents.length } },
    [wallet, proposals.length, txProposals.length, commandApprovals.length, watchers.length, subagents.length],
  );

  // Watcher form state
  const [chain, setChain] = useState<string>("solana");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const q = wallet ? `?wallet=${wallet}` : "";
      const [p, s, w, tx, ca] = await Promise.all([
        fetch(`/api/inbox/proposals${q}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/inbox/subagents${q}`, { cache: "no-store" }).then((r) => r.json()),
        wallet
          ? fetch(`/api/inbox/watchers?wallet=${wallet}`, { cache: "no-store" }).then((r) => r.json())
          : Promise.resolve({ watchers: [] }),
        fetch(`/api/inbox/tx-proposals${q}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/inbox/command-approvals${q}`, { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => ({ approvals: [] })),
      ]);
      setProposals(p?.proposals ?? []);
      setSubagents(s?.subagents ?? []);
      setWatchers(w?.watchers ?? []);
      setTxProposals(tx?.txProposals ?? []);
      setCommandApprovals(ca?.approvals ?? []);
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

  const actApproval = async (id: string, status: "approved" | "rejected") => {
    setBusyId(id);
    try {
      const res = await fetch("/api/inbox/command-approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error("approval_patch_failed");
      const json = (await res.json()) as {
        ok: boolean;
        approval?: any;
        signingEnvelope?: {
          serializedTransactions: string[];
          extraSigners?: Array<Array<{ publicKey: string; secretKeyBase64: string }>>;
          operation: string;
          buildErrors: string[];
          bundleStrategy?: "sequential" | "atomic";
          readResults?: Array<{
            capabilityId: string;
            sideEffects: string;
            summary?: string;
            output: unknown;
          }>;
        } | null;
      };

      // Reject → clear from pending; the row moves to Completed as 'rejected'.
      if (status === "rejected") {
        setCommandApprovals((prev) => prev.filter((a) => a.id !== id));
        toast.success("Rejected");
        await refresh();
        return;
      }

      const env = json.signingEnvelope;
      const bundleStrategy = env?.bundleStrategy ?? "sequential";
      // Read-only plan / nothing to sign → server already marked as executed
      // and persisted readResults. Move the row to the Completed tab and
      // show the user the deliverable instead of silently dropping it.
      if (!env || env.serializedTransactions.length === 0) {
        setCommandApprovals((prev) => prev.filter((a) => a.id !== id));
        if (env?.buildErrors?.length) {
          toast.warning("Approved — nothing to sign", {
            description: env.buildErrors[0].slice(0, 200),
          });
        } else {
          const resultCount = env?.readResults?.length ?? 0;
          toast.success("Delivered", {
            description:
              resultCount > 0
                ? `${resultCount} result${resultCount === 1 ? "" : "s"} — see Completed`
                : "See Completed tab",
          });
        }
        await refresh();
        setTab("completed");
        return;
      }


      // We have transactions to sign. Walk them through the connected wallet.
      if (!signTransaction && !signAllTransactions) {
        toast.error("Wallet not ready to sign", {
          description: "Connect a wallet that supports signing to continue.",
        });
        return;
      }

      // Lazy-import Keypair only when we actually need ephemeral co-signers
      // (e.g. Squads createMultisig's createKey).
      const needsEphemeral = (env.extraSigners ?? []).some((s) => s && s.length > 0);
      const Keypair = needsEphemeral ? (await import("@solana/web3.js")).Keypair : null;

      const latest = await connection.getLatestBlockhash("confirmed");

      const deserialized = env.serializedTransactions.map((b64, i) => {
        const buf = Buffer.from(b64, "base64");
        let tx: VersionedTransaction | Transaction;
        try {
          tx = VersionedTransaction.deserialize(buf);
        } catch {
          tx = Transaction.from(buf);
        }
        if (tx instanceof VersionedTransaction) {
          tx.message.recentBlockhash = latest.blockhash;
        } else {
          tx.recentBlockhash = latest.blockhash;
          tx.lastValidBlockHeight = latest.lastValidBlockHeight;
        }
        const stepSigners = (env.extraSigners ?? [])[i] ?? [];
        if (stepSigners.length > 0 && Keypair) {
          const kps = stepSigners.map((s) =>
            Keypair.fromSecretKey(Buffer.from(s.secretKeyBase64, "base64")),
          );
          if (tx instanceof VersionedTransaction) {
            tx.sign(kps);
          } else {
            tx.partialSign(...kps);
          }
        }
        return tx;
      });

      let useAtomic =
        bundleStrategy === "atomic" &&
        deserialized.length > 1 &&
        deserialized.every((t) => t instanceof VersionedTransaction) &&
        Boolean(publicKey);

      let toSign: (VersionedTransaction | Transaction)[] = [...deserialized];

      if (useAtomic && publicKey) {
        if (deserialized.length + 1 > 5) {
          useAtomic = false;
          toast.message("Atomic bundle skipped", {
            description: "Too many transactions for a Jito bundle. Sending sequentially.",
          });
        } else {
          try {
            const tipBuild = await buildJitoTipTx({
              connection,
              payer: publicKey,
              blockhash: latest.blockhash,
            });
            toSign = [...deserialized, tipBuild.tx];
          } catch (tipErr) {
            console.warn("[inbox] jito tip failed, sequential", tipErr);
            useAtomic = false;
            toSign = deserialized;
          }
        }
      } else if (bundleStrategy === "atomic") {
        if (deserialized.length <= 1) {
          useAtomic = false;
        } else if (!deserialized.every((t) => t instanceof VersionedTransaction)) {
          toast.message("Atomic bundle skipped", {
            description: "Legacy transaction format — sending sequentially.",
          });
          useAtomic = false;
        }
      }

      let signed: (VersionedTransaction | Transaction)[];
      if (signAllTransactions && toSign.length > 1) {
        signed = await signAllTransactions(toSign as VersionedTransaction[]);
      } else {
        signed = [];
        for (const tx of toSign) {
          const s = await (signTransaction as (
            tx: VersionedTransaction | Transaction,
          ) => Promise<VersionedTransaction | Transaction>)(tx);
          signed.push(s);
        }
      }

      const sigs: string[] = [];
      if (useAtomic) {
        const base64Txs = signed.map((tx) => Buffer.from(tx.serialize()).toString("base64"));
        const bundleRes = await fetch("/api/solana/jito-bundle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions: base64Txs }),
        });
        const bundleJson = await bundleRes.json().catch(() => ({}));
        if (!bundleRes.ok || bundleJson?.error) {
          throw new Error(`Atomic bundle rejected: ${bundleJson?.error ?? bundleRes.statusText}`);
        }
        const bundleId = bundleJson?.bundleId as string | undefined;
        for (const tx of signed) {
          try {
            const sigBytes = (tx as VersionedTransaction).signatures?.[0];
            if (sigBytes && sigBytes.length > 0) {
              const bs58 = await import("bs58");
              sigs.push(bs58.default.encode(sigBytes));
            }
          } catch {
            /* best-effort */
          }
        }
        if (bundleId) {
          const status = await pollJitoBundleStatus(bundleId, { timeoutMs: 30_000 });
          if (status.state === "failed") {
            throw new Error(`Atomic bundle failed: ${status.error ?? "unknown"}`);
          }
          if (status.state === "unknown") {
            toast.message("Bundle submitted, status pending", {
              description: `Bundle ${bundleId.slice(0, 10)}… is still landing.`,
            });
          }
        }
      } else {
        for (const tx of signed) {
          const raw = tx.serialize();
          const sig = await connection.sendRawTransaction(raw, {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          });
          const confirmation = await connection.confirmTransaction(
            { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
            "confirmed",
          );
          if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          }
          sigs.push(sig);
        }
      }

      // Settle the approval row to executed with the resulting signature.
      await fetch("/api/inbox/command-approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "executed", signature: sigs[0] }),
      });
      setCommandApprovals((prev) => prev.filter((a) => a.id !== id));
      toast.success(`${env.operation} signed & sent`, {
        description: `${sigs.length} tx · ${sigs[0].slice(0, 12)}…`,
      });
    } catch (e: any) {
      const msg = e?.message ?? "Failed to update approval";
      if (msg.includes("User rejected") || msg.includes("cancelled")) {
        toast.error("Signing cancelled");
      } else {
        toast.error(msg);
      }
    } finally {
      setBusyId(null);
    }
  };

  type TabKey = "pending" | "completed" | "proposals" | "subagents" | "watchers";
  const [tab, setTab] = useState<TabKey>("pending");
  const [completed, setCompleted] = useState<CommandApproval[]>([]);
  const [loadingCompleted, setLoadingCompleted] = useState(false);
  const [expandedCompleted, setExpandedCompleted] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (tab !== "completed") return;
    let cancelled = false;
    setLoadingCompleted(true);
    fetch(`/api/inbox/command-approvals?status=approved,executed,rejected`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setCompleted(j?.approvals ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingCompleted(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const toggleRow = (id: string) =>
    setExpandedRow((cur) => (cur === id ? null : id));

  const TABS: { key: TabKey; label: string; count: number; Icon: typeof InboxIcon }[] = [
    {
      key: "pending",
      label: "Pending",
      count: txProposals.length + commandApprovals.length,
      Icon: InboxIcon,
    },
    { key: "completed", label: "Completed", count: completed.length, Icon: CheckCircle2 },
    { key: "proposals", label: "Proposals", count: proposals.length, Icon: Radio },
    { key: "subagents", label: "Sub-agents", count: subagents.length, Icon: Bot },
    { key: "watchers", label: "Watchers", count: watchers.length, Icon: Eye },
  ];

  const sectionEmpty = (msg: string) => (
    <div className="rounded-xl border border-dashed border-violet-100 bg-white px-5 py-10 text-center text-[12.5px] text-neutral-500">
      {msg}
    </div>
  );

  // ── Compact table primitives ─────────────────────────────────────────
  const TableShell = ({ children }: { children: React.ReactNode }) => (
    <div className="overflow-hidden rounded-xl border border-violet-100 bg-white">
      <table className="w-full table-fixed text-left text-[12.5px]">{children}</table>
    </div>
  );

  const Th = ({ children, className = "" }: { children?: React.ReactNode; className?: string }) => (
    <th
      className={`px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400 ${className}`}
    >
      {children}
    </th>
  );

  const KindPill = ({ meta }: { meta: ReturnType<typeof classifyPlan> }) => (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full ${meta.bgClass} px-2 py-0.5 text-[10.5px] font-semibold ${meta.textClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
      {meta.label}
    </span>
  );

  return (
    <div className="flex-1 flex flex-col w-full max-w-full overflow-x-hidden md:h-screen md:overflow-hidden bg-white text-slate-900 relative font-[Manrope,sans-serif]">
      {/* ─── Universal app header ───────────────────────── */}
      <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-violet-100 bg-white z-10 shrink-0">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-600 shrink-0" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 truncate">
              dreyv // Command workspace
            </span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 uppercase">Inbox</h1>
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
              HITL
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <NotificationBell />
          <button
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-2.5 sm:px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-700 hover:bg-violet-50 transition-colors disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <Suspense fallback={<div className="hidden sm:block h-8 w-24 bg-muted animate-pulse rounded-full" />}>
            <div className="hidden sm:block"><CollaborativeHeader /></div>
          </Suspense>

          <div className="hidden sm:block w-px h-6 bg-border mx-1" />

          <WalletButton />
        </div>
      </header>

      {/* Ambient violet glow */}
      <div className="pointer-events-none absolute inset-x-0 top-16 -z-10 overflow-hidden h-[400px]">
        <div className="absolute -top-32 left-1/2 h-[340px] w-[680px] -translate-x-1/2 rounded-full bg-violet-300/20 blur-3xl" />
      </div>

      <div className="flex-1 md:overflow-y-auto scrollbar-thin">
        <section className="mx-auto max-w-5xl px-4 sm:px-6 pt-6 pb-4">
          <p className="text-[12.5px] text-muted-foreground mb-4">
            {wallet
              ? `Scoped to ${wallet.slice(0, 4)}…${wallet.slice(-4)} — connect a different wallet to switch.`
              : "Workspace-wide view. Connect a wallet to scope to your treasury."}
          </p>

          {/* Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin border-b border-violet-100">
            {TABS.map((t) => {
              const active = tab === t.key;
              const Icon = t.Icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`group relative inline-flex items-center gap-2 rounded-t-lg px-3 py-2 text-[12.5px] font-semibold transition-colors whitespace-nowrap ${
                    active
                      ? "bg-violet-600 text-white"
                      : "text-neutral-600 hover:bg-violet-50 hover:text-violet-700"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                  <span
                    className={`text-[10.5px] font-bold leading-none rounded-full px-1.5 py-px tabular-nums ${
                      active ? "bg-white/20 text-white" : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 sm:px-6 pb-16 space-y-3">
          {/* ─── PENDING ───────────────────────────────── */}
          {tab === "pending" && (
            <>
              {commandApprovals.length + txProposals.length === 0 ? (
                sectionEmpty(
                  "Nothing waiting. High-confidence plans (≥75%) queue here for your approval — nothing signs without you.",
                )
              ) : (
                <TableShell>
                  <colgroup>
                    <col className="w-[92px]" />
                    <col />
                    <col className="w-[160px]" />
                    <col className="w-[90px]" />
                    <col className="w-[220px]" />
                  </colgroup>
                  <thead className="bg-violet-50/40 border-b border-violet-100">
                    <tr>
                      <Th>Kind</Th>
                      <Th>Title</Th>
                      <Th className="text-right">Meta</Th>
                      <Th className="text-right">Age</Th>
                      <Th className="text-right pr-3">Actions</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-violet-50">
                    {commandApprovals.map((a) => {
                      const capIds = (a.plan?.steps ?? []).map((s) => s.capabilityId);
                      const meta = classifyPlan(capIds);
                      const value = a.estimatedValueUsd != null ? Number(a.estimatedValueUsd) : null;
                      const risk = a.riskScore != null ? Number(a.riskScore) : null;
                      const title = a.intent?.goal || a.intent?.rawText || a.plan?.rationale || a.reason;
                      const expanded = expandedRow === a.id;
                      return (
                        <Fragment key={a.id}>
                            <tr
                            className="group hover:bg-violet-50/40 transition-colors cursor-pointer"
                            onClick={() => toggleRow(a.id)}
                          >
                            <td className="px-3 py-2.5 align-top">
                              <KindPill meta={meta} />
                            </td>
                            <td className="px-3 py-2.5 align-top">
                              <div className="flex items-start gap-1.5">
                                {expanded ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-violet-500 mt-0.5 shrink-0" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-neutral-300 mt-0.5 shrink-0 group-hover:text-violet-500" />
                                )}
                                <span className="text-[12.5px] font-medium text-neutral-900 line-clamp-2">
                                  {title}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 align-top text-right text-[11px] text-neutral-500 tabular-nums">
                              {capIds.length} step{capIds.length === 1 ? "" : "s"}
                              {risk != null && <> · risk {risk.toFixed(2)}</>}
                              {formatUsd(value) && <> · {formatUsd(value)}</>}
                            </td>
                            <td className="px-3 py-2.5 align-top text-right text-[11px] text-neutral-400 tabular-nums">
                              {relTime(a.createdAt)}
                            </td>
                            <td className="px-3 py-2.5 align-top pr-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-1.5">
                                <button
                                  disabled={busyId === a.id}
                                  onClick={() => actApproval(a.id, "approved")}
                                  className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                                >
                                  {busyId === a.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Check className="h-3 w-3" />
                                  )}
                                  {meta.actionLabel}
                                </button>
                                <button
                                  disabled={busyId === a.id}
                                  onClick={() => actApproval(a.id, "rejected")}
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {expanded && (
                            <tr key={a.id + "-x"} className="bg-violet-50/20">
                              <td colSpan={5} className="px-4 py-3">
                                <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
                                  <div>
                                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                                      Why this needs approval
                                    </div>
                                    <div className="rounded-md border border-violet-100 bg-white px-3 py-2 text-[12px] text-neutral-800">
                                      {a.reason}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                                      Plan steps
                                    </div>
                                    <ol className="space-y-1 rounded-md border border-violet-100 bg-white px-3 py-2 text-[11.5px] text-neutral-700">
                                      {capIds.length === 0 && <li className="text-neutral-400">No steps declared.</li>}
                                      {capIds.map((c, i) => (
                                        <li key={i} className="flex items-start gap-2">
                                          <span className="w-4 text-neutral-400 tabular-nums">{i + 1}.</span>
                                          <span className="font-mono text-violet-700">{c}</span>
                                        </li>
                                      ))}
                                    </ol>
                                  </div>
                                </div>
                                {a.expiresAt && (
                                  <div className="mt-2 text-[10.5px] text-neutral-400">
                                    Expires {new Date(a.expiresAt).toLocaleString()}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}

                    {txProposals.map((t) => {
                      const expanded = expandedRow === t.id;
                      const meta = classifyPlan([t.kind]);
                      return (
                        <Fragment key={t.id}>
                            <tr
                            className="group hover:bg-violet-50/40 transition-colors cursor-pointer"
                            onClick={() => toggleRow(t.id)}
                          >
                            <td className="px-3 py-2.5 align-top">
                              <KindPill meta={meta} />
                            </td>
                            <td className="px-3 py-2.5 align-top">
                              <div className="flex items-start gap-1.5">
                                {expanded ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-violet-500 mt-0.5 shrink-0" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-neutral-300 mt-0.5 shrink-0 group-hover:text-violet-500" />
                                )}
                                <span className="text-[12.5px] font-medium text-neutral-900 line-clamp-2">
                                  {t.summary}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 align-top text-right text-[11px] text-neutral-500 tabular-nums">
                              {t.routing} · risk {t.riskLevel}
                              {t.estimatedFeeSol && <> · ◎{Number(t.estimatedFeeSol).toFixed(6)}</>}
                            </td>
                            <td className="px-3 py-2.5 align-top text-right text-[11px] text-neutral-400 tabular-nums">
                              {relTime(t.createdAt)}
                            </td>
                            <td className="px-3 py-2.5 align-top pr-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-1.5">
                                <button
                                  disabled={busyId === t.id}
                                  onClick={() => actTx(t.id, "approve")}
                                  className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                                >
                                  {busyId === t.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Check className="h-3 w-3" />
                                  )}
                                  Sign
                                </button>
                                <button
                                  disabled={busyId === t.id}
                                  onClick={() => actTx(t.id, "reject")}
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="bg-violet-50/20">
                              <td colSpan={5} className="px-4 py-3">
                                {t.errorMessage && (
                                  <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                                    {t.errorMessage}
                                  </div>
                                )}
                                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1">
                                  Instructions
                                </div>
                                <pre className="max-h-56 overflow-auto rounded-md border border-violet-100 bg-white px-3 py-2 text-[10.5px] leading-snug text-neutral-700">
                                  {JSON.stringify(t.instructions ?? [], null, 2)}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </TableShell>
              )}
            </>
          )}

          {/* ─── COMPLETED ─────────────────────────────── */}
          {tab === "completed" && (
            <>
              {loadingCompleted && completed.length === 0
                ? sectionEmpty("Loading…")
                : completed.length === 0
                  ? sectionEmpty(
                      "Nothing here yet. Approved briefings, reports, and executed trades will appear here with their deliverables.",
                    )
                  : (
                    <TableShell>
                      <colgroup>
                        <col className="w-[92px]" />
                        <col />
                        <col className="w-[100px]" />
                        <col className="w-[100px]" />
                        <col className="w-[80px]" />
                      </colgroup>
                      <thead className="bg-violet-50/40 border-b border-violet-100">
                        <tr>
                          <Th>Kind</Th>
                          <Th>Title</Th>
                          <Th className="text-right">Status</Th>
                          <Th className="text-right">When</Th>
                          <Th className="text-right pr-3">View</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-violet-50">
                        {completed.map((a) => {
                          const capIds = (a.plan?.steps ?? []).map((s) => s.capabilityId);
                          const meta = classifyPlan(capIds);
                          const decision = (a as any).decision as
                            | { signingEnvelope?: DeliverablePayload; signature?: string }
                            | null;
                          const payload: DeliverablePayload = {
                            ...(decision?.signingEnvelope ?? {}),
                            signature: decision?.signature ?? (a as any).signature ?? null,
                          };
                          const resultCount =
                            (payload.readResults?.length ?? 0) + (payload.signature ? 1 : 0);
                          const title = a.intent?.goal || a.intent?.rawText || a.plan?.rationale || a.reason;
                          const expanded = expandedRow === a.id;
                          const statusChip =
                            a.status === "executed"
                              ? "bg-violet-600 text-white"
                              : a.status === "rejected"
                                ? "bg-slate-200 text-slate-700"
                                : "bg-violet-100 text-violet-700";
                          return (
                            <Fragment key={a.id}>
                            <tr
                                className="group hover:bg-violet-50/40 transition-colors cursor-pointer"
                                onClick={() => toggleRow(a.id)}
                              >
                                <td className="px-3 py-2.5 align-top">
                                  <KindPill meta={meta} />
                                </td>
                                <td className="px-3 py-2.5 align-top">
                                  <div className="flex items-start gap-1.5">
                                    {expanded ? (
                                      <ChevronDown className="h-3.5 w-3.5 text-violet-500 mt-0.5 shrink-0" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5 text-neutral-300 mt-0.5 shrink-0 group-hover:text-violet-500" />
                                    )}
                                    <div className="min-w-0">
                                      <div className="text-[12.5px] font-medium text-neutral-900 line-clamp-2">
                                        {title}
                                      </div>
                                      {resultCount > 0 && (
                                        <div className="mt-0.5 text-[10.5px] text-neutral-500">
                                          {resultCount} deliverable{resultCount === 1 ? "" : "s"}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 align-top text-right">
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusChip}`}>
                                    {a.status}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 align-top text-right text-[11px] text-neutral-400 tabular-nums">
                                  {relTime(a.createdAt)}
                                </td>
                                <td className="px-3 py-2.5 align-top pr-3 text-right">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleRow(a.id);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-white px-2 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
                                  >
                                    {expanded ? "Hide" : "Open"}
                                  </button>
                                </td>
                              </tr>
                              {expanded && (
                                <tr className="bg-violet-50/20">
                                  <td colSpan={5} className="px-4 py-3">
                                    {(a as any).resolutionNote && (
                                      <p className="mb-2 text-[12px] text-neutral-700">
                                        {(a as any).resolutionNote}
                                      </p>
                                    )}
                                    <DeliverableView payload={payload} />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </TableShell>
                  )}
            </>
          )}

          {/* ─── PROPOSALS ─────────────────────────────── */}
          {tab === "proposals" && (
            <>
              {loading && proposals.length === 0
                ? sectionEmpty("Loading…")
                : proposals.length === 0
                  ? sectionEmpty("No open items. The fabric is watching — anything escalated will land here.")
                  : (
                    <TableShell>
                      <colgroup>
                        <col className="w-[92px]" />
                        <col />
                        <col className="w-[180px]" />
                        <col className="w-[90px]" />
                        <col className="w-[180px]" />
                      </colgroup>
                      <thead className="bg-violet-50/40 border-b border-violet-100">
                        <tr>
                          <Th>Kind</Th>
                          <Th>Thesis</Th>
                          <Th className="text-right">Confidence</Th>
                          <Th className="text-right">Age</Th>
                          <Th className="text-right pr-3">Actions</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-violet-50">
                        {proposals.map((p) => {
                          const capIds = (p.actions ?? []).map((a) => a.op);
                          const meta = classifyPlan(capIds);
                          const expanded = expandedRow === p.id;
                          return (
                            <Fragment key={p.id}>
                            <tr
                                className="group hover:bg-violet-50/40 transition-colors cursor-pointer"
                                onClick={() => toggleRow(p.id)}
                              >
                                <td className="px-3 py-2.5 align-top">
                                  <KindPill meta={meta} />
                                </td>
                                <td className="px-3 py-2.5 align-top">
                                  <div className="flex items-start gap-1.5">
                                    {expanded ? (
                                      <ChevronDown className="h-3.5 w-3.5 text-violet-500 mt-0.5 shrink-0" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5 text-neutral-300 mt-0.5 shrink-0 group-hover:text-violet-500" />
                                    )}
                                    <div className="min-w-0">
                                      <div className="text-[12.5px] font-semibold text-neutral-900 line-clamp-1">
                                        {p.title}
                                      </div>
                                      <div className="mt-0.5 text-[11.5px] text-neutral-600 line-clamp-2">
                                        {p.thesis}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 align-top text-right text-[11px] text-neutral-500 tabular-nums">
                                  {Number(p.confidence).toFixed(2)} · {p.horizon}
                                </td>
                                <td className="px-3 py-2.5 align-top text-right text-[11px] text-neutral-400 tabular-nums">
                                  {relTime(p.createdAt)}
                                </td>
                                <td className="px-3 py-2.5 align-top pr-3" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex justify-end gap-1.5">
                                    <button
                                      disabled={busyId === p.id}
                                      onClick={() => act(p.id, "acted")}
                                      className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                                    >
                                      <Check className="h-3 w-3" /> Acted
                                    </button>
                                    <button
                                      disabled={busyId === p.id}
                                      onClick={() => act(p.id, "dismissed")}
                                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                                    >
                                      <X className="h-3 w-3" /> Dismiss
                                    </button>
                                  </div>
                                </td>
                              </tr>
                              {expanded && (
                                <tr className="bg-violet-50/20">
                                  <td colSpan={5} className="px-4 py-3 space-y-2">
                                    {p.actions?.length > 0 && (
                                      <div>
                                        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                                          Suggested actions
                                        </div>
                                        <ul className="space-y-1">
                                          {p.actions.map((ac, i) => (
                                            <li
                                              key={i}
                                              className="flex items-start gap-2 rounded-md border border-violet-100 bg-white px-2.5 py-1.5 text-[11.5px] text-neutral-700"
                                            >
                                              <span className="font-mono font-semibold text-violet-700">{ac.op}</span>
                                              {ac.rationale && <span className="text-neutral-500">— {ac.rationale}</span>}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {p.riskNotes?.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {p.riskNotes.map((r, i) => (
                                          <span
                                            key={i}
                                            className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] text-amber-700"
                                          >
                                            {r}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </TableShell>
                  )}
            </>
          )}

          {/* ─── SUB-AGENTS ────────────────────────────── */}
          {tab === "subagents" && (
            <>
              {subagents.length === 0
                ? sectionEmpty("No sub-agents spawned yet. The reflector spawns them from high-confidence deep proposals.")
                : (
                  <TableShell>
                    <colgroup>
                      <col className="w-[120px]" />
                      <col />
                      <col className="w-[220px]" />
                      <col className="w-[140px]" />
                    </colgroup>
                    <thead className="bg-violet-50/40 border-b border-violet-100">
                      <tr>
                        <Th>Parent</Th>
                        <Th>Name / Goal</Th>
                        <Th>Capabilities</Th>
                        <Th className="text-right pr-3">TTL</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-violet-50">
                      {subagents.map((s) => (
                        <tr key={s.id} className="hover:bg-violet-50/40 transition-colors">
                          <td className="px-3 py-2.5 align-top">
                            <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[10.5px] font-semibold text-violet-700">
                              {s.parent}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <div className="text-[12.5px] font-semibold text-neutral-900">{s.name}</div>
                            <div className="mt-0.5 text-[11.5px] text-neutral-600 line-clamp-2">{s.goal}</div>
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <div className="flex flex-wrap gap-1">
                              {s.capabilities?.slice(0, 4).map((c) => (
                                <span
                                  key={c}
                                  className="rounded-md border border-violet-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-violet-700"
                                >
                                  {c}
                                </span>
                              ))}
                              {s.capabilities?.length > 4 && (
                                <span className="text-[10px] text-neutral-400">
                                  +{s.capabilities.length - 4}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 align-top pr-3 text-right text-[11px] text-neutral-500 tabular-nums">
                            {s.ttlMinutes}m
                            <div className="text-[10px] text-neutral-400">
                              exp {relTime(s.expiresAt)}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                )}
            </>
          )}

          {/* ─── WATCHERS ──────────────────────────────── */}
          {tab === "watchers" && (
            <>
              {!wallet ? (
                sectionEmpty("Connect a wallet to manage treasury watchers.")
              ) : (
                <div className="space-y-3">
                  <form
                    onSubmit={addWatcher}
                    className="flex flex-wrap items-end gap-2 rounded-xl border border-violet-100 bg-white p-3"
                  >
                    <div className="flex flex-col">
                      <label className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                        Chain
                      </label>
                      <select
                        value={chain}
                        onChange={(e) => setChain(e.target.value)}
                        className="h-8 rounded-md border border-violet-200 bg-white px-2 text-[12px]"
                      >
                        {CHAINS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex min-w-[220px] flex-1 flex-col">
                      <label className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                        Address
                      </label>
                      <Input
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="0x… or Solana pubkey"
                        className="h-8 border-violet-200 text-[12px]"
                      />
                    </div>
                    <div className="flex flex-col">
                      <label className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                        Label
                      </label>
                      <Input
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="optional"
                        className="h-8 border-violet-200 text-[12px]"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={adding || !address}
                      className="inline-flex h-8 items-center gap-1 rounded-md bg-violet-600 px-3 text-[11.5px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                    >
                      <Plus className="h-3 w-3" /> Watch
                    </button>
                  </form>

                  {watchers.length === 0 ? (
                    sectionEmpty("No watchers yet. Add a wallet or contract above to start monitoring.")
                  ) : (
                    <TableShell>
                      <colgroup>
                        <col className="w-[80px]" />
                        <col />
                        <col className="w-[180px]" />
                        <col className="w-[50px]" />
                      </colgroup>
                      <thead className="bg-violet-50/40 border-b border-violet-100">
                        <tr>
                          <Th>Chain</Th>
                          <Th>Address / Label</Th>
                          <Th className="text-right">Last scan</Th>
                          <Th className="pr-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-violet-50">
                        {watchers.map((w) => (
                          <tr key={w.id} className="hover:bg-violet-50/40">
                            <td className="px-3 py-2 align-middle">
                              <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[10.5px] font-semibold text-violet-700">
                                {w.chain}
                              </span>
                            </td>
                            <td className="px-3 py-2 align-middle">
                              <div className="font-mono text-[11.5px] text-neutral-800">
                                {w.address.slice(0, 8)}…{w.address.slice(-6)}
                              </div>
                              {w.label && (
                                <div className="text-[10.5px] text-neutral-500">{w.label}</div>
                              )}
                            </td>
                            <td className="px-3 py-2 align-middle text-right text-[10.5px] text-neutral-400 tabular-nums">
                              {w.lastScanAt ? relTime(w.lastScanAt) : "never"}
                            </td>
                            <td className="px-3 py-2 align-middle pr-3 text-right">
                              <button
                                onClick={() => removeWatcher(w.id)}
                                className="rounded-md p-1 text-neutral-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                                aria-label="Remove watcher"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </TableShell>
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

