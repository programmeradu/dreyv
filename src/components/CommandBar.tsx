"use client";

// Feature: commandbar-god-mode
// Root CommandBar component — God Mode execution layer.
// Merges and supersedes CommandBar.tsx + CommandBar.stream.tsx.
// Requirements: 1.1–1.8, 2.6, 3.1, 3.6, 3.7, 13.1, 13.4, 16.1–16.4, 17.1–17.3

import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { Send } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { IntentRegistry } from "@/lib/agents/registry";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast-notifications";
import { useSimulationStore, type SimulationResult } from "@/lib/stores/simulation-store";
import { useVault } from "@/lib/contexts/VaultContext";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useConnection, useWallet } from "@/lib/wallet/compat";
import { VersionedTransaction, Transaction } from "@solana/web3.js";
import { useCommandBarSigningStore } from "@/lib/stores/commandbar-signing-store";
import { buildProtocolFeeTx } from "@/lib/commandbar/protocol-fee";
import { buildJitoTipTx, pollJitoBundleStatus } from "@/lib/solana/jito-bundle";
import { ChatMessage } from "@/components/commandbar/ChatMessage";
import { EmptyState } from "@/components/commandbar/EmptyState";
import { TOKEN_LOGOS } from "@/components/commandbar/ChatMessage";
import { HandoffStream } from "@/components/commandbar/HandoffStream";
import { PipelineHeader } from "@/components/commandbar/PipelineHeader";
import { PendingApprovalsBanner } from "@/components/commandbar/PendingApprovalsBanner";
import { ActiveSubagentsBadge } from "@/components/commandbar/ActiveSubagentsBadge";
import { useOptionalCanvas } from "@/lib/canvas/CanvasContext";
import { useCommandFocus } from "@/lib/commandbar/focus-context";

// ─── Types ────────────────────────────────────────────────────────────────────

type PromptMode = "auto" | "build" | "execute";

/** Requirement 12.2–12.4: only these routes may be pushed from tool results. */
const ALLOWED_COMMAND_BAR_ROUTES = new Set([
  "/app",
  "/app/treasury",
  "/app/analytics",
  "/app/studio",
  "/app/marketplace",
  "/app/library",
  "/app/team",
  "/app/settings",
  "/app/atlas",
]);

function normalizeNavPath(path: string): string {
  const u = path.trim();
  const noQuery = u.split("?")[0]?.split("#")[0] ?? u;
  return noQuery.length > 1 && noQuery.endsWith("/") ? noQuery.slice(0, -1) : noQuery;
}

function isAllowedCommandBarRoute(path: string): boolean {
  return ALLOWED_COMMAND_BAR_ROUTES.has(normalizeNavPath(path));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getToolParts(m: UIMessage) {
  return (
    m.parts?.flatMap((p) => {
      if (p.type === "dynamic-tool") return [p];
      if (
        typeof p.type === "string" &&
        p.type.startsWith("tool-") &&
        "toolCallId" in p
      ) {
        return [{ ...p, type: "dynamic-tool" as const, toolName: p.type.slice(5) }];
      }
      return [];
    }) || []
  );
}

/** Parse prompt mode prefix from user input (client-side, for footer display only). Matches /api/command `parsePromptMode`. */
function parsePromptModeFromInput(text: string): PromptMode {
  const t = text.trim().toLowerCase();
  if (/^(mode\s*:\s*build|\/build\b|#build\b|\[build\]|build mode\b)/.test(t)) return "build";
  if (/^(mode\s*:\s*execute|\/execute\b|#execute\b|\[execute\]|execute mode\b)/.test(t)) return "execute";
  return "auto";
}

/** Convert foresight_simulation tool variables to /api/simulation SimulationVariable[] */
function foresightVariablesToSimulationVariables(
  variables: Record<string, unknown>,
): Array<{
  id: string;
  label: string;
  type: "price_change" | "burn_rate" | "inflow" | "outflow" | "yield_apy" | "custom";
  asset?: string;
  value: number;
  unit: "percent" | "usd" | "tokens";
}> {
  const out: Array<{
    id: string;
    label: string;
    type: "price_change" | "burn_rate" | "inflow" | "outflow" | "yield_apy" | "custom";
    asset?: string;
    value: number;
    unit: "percent" | "usd" | "tokens";
  }> = [];
  if (typeof variables.solDrop === "number") {
    out.push({ id: "sol-drop", label: "SOL price change", type: "price_change", asset: "SOL", value: -variables.solDrop, unit: "percent" });
  }
  if (typeof variables.usdcDepeg === "number") {
    out.push({ id: "usdc-depeg", label: "USDC depeg", type: "price_change", asset: "USDC", value: -variables.usdcDepeg, unit: "percent" });
  }
  if (typeof variables.monthlyBurn === "number") {
    out.push({ id: "burn", label: "Monthly burn", type: "burn_rate", value: variables.monthlyBurn, unit: "usd" });
  }
  if (typeof variables.apy === "number") {
    out.push({ id: "apy", label: "Yield APY", type: "yield_apy", value: variables.apy, unit: "percent" });
  }
  if (typeof variables.principal === "number") {
    out.push({ id: "principal", label: "Principal", type: "custom", value: variables.principal, unit: "usd" });
  }
  if (typeof variables.newHires === "number") {
    out.push({
      id: "new-hires",
      label: "New hires",
      type: "outflow",
      value: variables.newHires * ((variables.costPerHire as number) || 8000),
      unit: "usd",
    });
  }
  if (out.length === 0) {
    out.push({ id: "default", label: "Scenario", type: "custom", value: 0, unit: "percent" });
  }
  return out;
}

// ─── CommandBar ───────────────────────────────────────────────────────────────

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [promptMode, setPromptMode] = useState<PromptMode>("auto");
  const [submitPulse, setSubmitPulse] = useState(false);
  const [activeSpecialist, setActiveSpecialist] = useState<string | null>(null);

  const { setSigningToolId, setSigningStatus, setTxSignatures } =
    useCommandBarSigningStore();

  const router = useRouter();
  const simStore = useSimulationStore();
  const { vaultTokens, activeVault, setActiveVault, addVault, refresh, refreshRegistry } = useVault();
  const { connection } = useConnection();
  const { publicKey, signAllTransactions, signTransaction, connected } = useWallet();
  const canvas = useOptionalCanvas();

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalPanelRef = useRef<HTMLDivElement>(null);
  // Currently-streaming plan block id (one per in-flight prompt).
  const activePlanBlockIdRef = useRef<string | null>(null);

  // ─── Signing ───────────────────────────────────────────────────────────────

  const handleSignTransactions = useCallback(
    async (
      toolCallId: string,
      serialized: string[],
      operation: string,
      extraSigners?: Array<Array<{ publicKey: string; secretKeyBase64: string }>>,
      estimatedValueUsd?: number | null,
      metadata?: Record<string, unknown>,
    ) => {
      if (!connected || !publicKey || (!signAllTransactions && !signTransaction)) {
        toast.error("Wallet not connected", {
          description: "Please connect your wallet to sign transactions.",
        });
        return;
      }

      setSigningToolId(toolCallId);
      setSigningStatus("signing");
      setTxSignatures([]);

      try {
        const needsEphemeral = (extraSigners ?? []).some((s) => s && s.length > 0);
        const Keypair = needsEphemeral ? (await import("@solana/web3.js")).Keypair : null;

        // Fetch a fresh blockhash NOW. The server-built tx may have been
        // sitting in the approval card long enough for its blockhash to
        // expire (~60s on mainnet) — signing with the stale one yields
        // "Blockhash not found" at submit time.
        const latest = await connection.getLatestBlockhash("confirmed");

        const deserialized = serialized.map((b64, i) => {
          const buf = Buffer.from(b64, "base64");
          let tx: VersionedTransaction | Transaction;
          try {
            tx = VersionedTransaction.deserialize(buf);
          } catch {
            tx = Transaction.from(buf);
          }
          // Refresh blockhash before any signing happens — blockhash is part
          // of the signed message, so it MUST be set before partial/wallet
          // signatures are applied.
          if (tx instanceof VersionedTransaction) {
            tx.message.recentBlockhash = latest.blockhash;
          } else {
            tx.recentBlockhash = latest.blockhash;
            tx.lastValidBlockHeight = latest.lastValidBlockHeight;
          }
          // Apply ephemeral co-signers (e.g. Squads createKey) before the
          // wallet sees the tx — otherwise the wallet refuses to sign because
          // a required signature slot is empty.
          const stepSigners = (extraSigners ?? [])[i] ?? [];
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

        // Append protocol fee (0.05%) — wallet signs it in the same batch.
        let feeInfo: { feeLamports: number; feeUsd: number } | null = null;
        try {
          const feeRes = await buildProtocolFeeTx({
            connection,
            payer: publicKey,
            estimatedValueUsd: estimatedValueUsd ?? null,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          });
          if (feeRes) {
            deserialized.push(feeRes.tx);
            feeInfo = { feeLamports: feeRes.feeLamports, feeUsd: feeRes.feeUsd };
          }
        } catch (e) {
          console.warn("[CommandBar] protocol fee build skipped:", e);
        }

        // Bundle strategy: capabilities can mark high-risk multi-leg flows
        // (rebalance, mass payouts, stablecoin diversification) as atomic.
        // For atomic flows we add a small Jito tip and submit the whole
        // signed batch as a Jito bundle so all txs land in the same slot
        // or none do. Jito caps at 5 txs per bundle; if we exceed that
        // (with the tip + protocol fee included), fall back to sequential.
        const wantsAtomic =
          (metadata as { bundleStrategy?: unknown } | undefined)?.bundleStrategy ===
          "atomic";
        let useAtomicBundle = wantsAtomic && deserialized.length + 1 <= 5;
        let jitoTipInfo: { tipAccount: string; tipLamports: number } | null = null;
        if (useAtomicBundle) {
          try {
            const tipBuild = await buildJitoTipTx({
              connection,
              payer: publicKey,
              blockhash: latest.blockhash,
            });
            deserialized.push(tipBuild.tx);
            jitoTipInfo = {
              tipAccount: tipBuild.tipAccount,
              tipLamports: tipBuild.tipLamports,
            };
          } catch (tipErr) {
            console.warn("[CommandBar] jito tip build failed; falling back to sequential", tipErr);
            useAtomicBundle = false;
          }
        } else if (wantsAtomic) {
          console.warn(
            "[CommandBar] atomic bundle requested but >5 txs after fees; submitting sequentially.",
          );
        }

        let signed: (VersionedTransaction | Transaction)[];
        if (signAllTransactions && deserialized.length > 1) {
          signed = await signAllTransactions(deserialized as VersionedTransaction[]);
        } else {
          signed = [];
          for (const tx of deserialized) {
            const s = await (
              signTransaction as (
                tx: VersionedTransaction | Transaction,
              ) => Promise<VersionedTransaction | Transaction>
            )(tx);
            signed.push(s);
          }
        }

        const sigs: string[] = [];
        if (useAtomicBundle) {
          // Submit atomically via Jito. The route returns a bundleId; we
          // poll for landing and then derive per-tx signatures from the
          // signed payloads (Jito doesn't return a single sig for the
          // bundle). On bundle rejection nothing has executed on-chain,
          // so the user sees a clean retry path.
          const base64Txs = signed.map((tx) => Buffer.from(tx.serialize()).toString("base64"));
          const bundleRes = await fetch("/api/solana/jito-bundle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transactions: base64Txs }),
          });
          const bundleJson = await bundleRes.json().catch(() => ({}));
          if (!bundleRes.ok || bundleJson?.error) {
            throw new Error(
              `Atomic bundle rejected: ${bundleJson?.error ?? bundleRes.statusText}`,
            );
          }
          const bundleId = bundleJson?.bundleId as string | undefined;
          // Best-effort: pull per-tx sigs from the signed payloads we just
          // computed. Bundle status confirms when they land.
          for (const tx of signed) {
            try {
              const sigBytes = (tx as VersionedTransaction).signatures?.[0];
              if (sigBytes && sigBytes.length > 0) {
                const bs58 = await import("bs58");
                sigs.push(bs58.default.encode(sigBytes));
              }
            } catch {
              // ignore — best effort
            }
          }
          if (bundleId) {
            const status = await pollJitoBundleStatus(bundleId, { timeoutMs: 30_000 });
            if (status.state === "failed") {
              throw new Error(`Atomic bundle failed: ${status.error ?? "unknown"}`);
            }
            if (status.state === "unknown") {
              // Don't hard-fail the UI on an inconclusive poll — surface a
              // softer warning so users can verify on-chain.
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
              throw new Error(`Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
            }
            sigs.push(sig);
          }
        }

        setTxSignatures(sigs);
        setSigningStatus("sent");

        // Persist to backend so /app/admin metrics (transaction_cache +
        // agent_executions) reflect the user-signed activity. Best-effort —
        // don't block the UI on logging.
        // The fee tx is the LAST signature in the batch (we appended it
        // after deserializing the user txs). Pass it separately so the
        // backend can ledger the protocol fee independently.
        const feeSignature = feeInfo ? sigs[sigs.length - 1] ?? null : null;
        const userSignatures = feeInfo ? sigs.slice(0, -1) : sigs;
        if (operation === "create_multisig" && typeof metadata?.multisigPda === "string") {
          const multisigPda = metadata.multisigPda;
          // Switch the active vault context immediately so all surfaces
          // (VaultSelector, status bar, analytics, watchers) re-render against
          // the new Squads PDA without waiting for the registry round-trip.
          setActiveVault(multisigPda);
          void addVault({ address: multisigPda, label: "Squads multisig", kind: "multisig" })
            .then(async (res) => {
              await Promise.all([refreshRegistry(), refresh()]);
              if (res?.ok) {
                toast.success("Multisig added to your vaults", {
                  description: `${multisigPda.slice(0, 6)}…${multisigPda.slice(-4)} is now your active treasury.`,
                });
              } else if (res && !res.ok) {
                toast.error("Couldn't register multisig", {
                  description: res.error || "Add it manually from the vault selector.",
                });
              }
            })
            .catch((e) => console.warn("[CommandBar] multisig vault register failed", e));
        }
        fetch("/api/tx/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signatures: userSignatures,
            operation,
            toolName: operation,
            source: "commandbar",
            estimatedValueUsd: estimatedValueUsd ?? null,
            protocolFee: feeInfo
              ? {
                  parentSignature: userSignatures[0] ?? feeSignature,
                  feeSignature,
                  feeLamports: feeInfo.feeLamports,
                  feeUsd: feeInfo.feeUsd,
                }
              : null,
          }),
        }).catch((e) => console.warn("[CommandBar] tx log failed", e));

        toast.success(`${operation} signed & sent`, {
          description: `${sigs.length} transaction(s) confirmed. Sig: ${sigs[0]?.slice(0, 12)}…`,
        });
      } catch (err: unknown) {
        let msg = err instanceof Error ? err.message : String(err);
        // web3.js SendTransactionError stashes RPC logs behind getLogs()
        // and they're the only useful signal for "this account may not be
        // used to pay transaction fees" / "insufficient lamports" failures.
        try {
          const anyErr = err as { getLogs?: (c?: unknown) => Promise<string[] | null> };
          if (typeof anyErr?.getLogs === "function") {
            const logs = await anyErr.getLogs(connection).catch(() => null);
            if (logs && logs.length) {
              msg += `\n\nProgram logs:\n${logs.join("\n")}`;
              console.error("[CommandBar] SendTransactionError logs:\n" + logs.join("\n"));
            }
          }
        } catch {
          /* non-fatal */
        }
        console.error("[CommandBar] Signing error:", msg);
        setSigningStatus("error");
        if (msg.includes("User rejected") || msg.includes("cancelled")) {
          toast.error("Transaction rejected", {
            description: "You declined the signing request.",
          });
        } else {
          toast.error("Signing failed", { description: msg.slice(0, 600) });
        }
      }
    },
    [connected, publicKey, signAllTransactions, signTransaction, connection, setSigningToolId, setSigningStatus, setTxSignatures, setActiveVault, addVault, refresh, refreshRegistry],
  );

  // ─── Chat ──────────────────────────────────────────────────────────────────

  const focus = useCommandFocus();
  const focusRef = useRef(focus);
  useEffect(() => { focusRef.current = focus; }, [focus]);

  // Phase 7 — buffer agent push events; flush them on the next outgoing turn
  // so the model can reason about autopilot runs / new proposals / errors.
  const pendingPushesRef = useRef<unknown[]>([]);
  useEffect(() => {
    const onPush = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) pendingPushesRef.current.push(detail);
      // Cap to last 20.
      if (pendingPushesRef.current.length > 20) {
        pendingPushesRef.current = pendingPushesRef.current.slice(-20);
      }
    };
    window.addEventListener("agent:push", onPush);
    return () => window.removeEventListener("agent:push", onPush);
  }, []);

  const transport = useMemo(
    () => new DefaultChatTransport({
      api: "/api/command",
      prepareSendMessagesRequest: ({ messages, body }) => {
        const pushes = pendingPushesRef.current;
        pendingPushesRef.current = [];
        return {
          body: {
            ...(body ?? {}),
            messages,
            focusContext: focusRef.current,
            agentPushes: pushes.length ? pushes : undefined,
          },
        };
      },
    }),
    [],
  );

  const { messages, sendMessage, setMessages, status, error: chatError } = useChat({
    transport,
    onError: (e: Error) => {
      const msg = e.message || "";
      if (
        /rate.?limit|429|retry|provider|groq|cloudflare|tool call validation failed|was not in request\.tools|invalid_request_error/i.test(
          msg,
        )
      ) {
        console.warn(
          "[CommandBar] Transient stream issue (auto-fallback/retry expected):",
          msg.slice(0, 220),
        );
        return;
      }
      console.error("[CommandBar] Stream error:", e);
      toast.error("Agent Error", { description: msg });
    },
    onFinish: ({ message }) => {
      // Finalize the active plan block with the full tool sequence + outcome.
      const planId = activePlanBlockIdRef.current;
      if (canvas && planId) {
        const toolParts = getToolParts(message);
        const steps = toolParts.map((p) => {
          const out = (p.state === "output-available"
            ? (p.output as Record<string, unknown> | undefined)
            : undefined);
          const failed = out?.success === false;
          return {
            title: String(p.toolName ?? "step"),
            detail:
              typeof out?.message === "string"
                ? (out.message as string)
                : typeof out?.operation === "string"
                  ? `operation: ${out.operation as string}`
                  : undefined,
            status: failed ? "failed" : p.state === "output-available" ? "success" : "running",
          };
        });
        const anyFailed = steps.some((s) => s.status === "failed");
        const textPart = message.parts?.find((p) => p.type === "text") as
          | { text?: string }
          | undefined;
        canvas.updateBlock(planId, {
          subtitle: anyFailed ? "Completed with errors" : "Complete",
          payload: {
            status: anyFailed ? "error" : "complete",
            summary:
              textPart?.text?.slice(0, 240) ||
              (steps.length
                ? `Ran ${steps.length} step${steps.length === 1 ? "" : "s"}.`
                : "Agent finished."),
            steps,
          },
        });
        activePlanBlockIdRef.current = null;
      }

      for (const part of getToolParts(message)) {
        if (part.state !== "output-available") continue;
        const output = part.output as Record<string, unknown> | undefined;
        if (!output) continue;

        const pushIfAllowed = (path: string) => {
          const raw = path.trim();
          if (!isAllowedCommandBarRoute(raw)) {
            console.warn("[CommandBar] Blocked navigation to disallowed path:", path);
            return;
          }
          setOpen(false);
          // Preserve ?appId= and other query params (normalizeNavPath strips them)
          router.push(raw);
        };

        if (output.success !== false && typeof output.navigateTo === "string" && output.navigateTo.trim()) {
          pushIfAllowed(output.navigateTo);
        }

        if (
          output.operation === "navigate" &&
          output.success !== false &&
          output.validated === true &&
          typeof output.path === "string" &&
          output.path.trim()
        ) {
          pushIfAllowed(output.path);
        }

        if (
          output.operation === "foresight_simulation" &&
          output.variables &&
          output.success !== false
        ) {
          const scenario = output.scenario as string;
          const timeframeMonths = (output.timeframeMonths as number) || 12;
          const variablesRecord = output.variables as Record<string, unknown>;
          const ir = (output.ir as import("@/lib/foresight/simulation-ir").SimulationIR | undefined) ?? null;
          const flatFromIr = output.flatVariables as ReturnType<typeof foresightVariablesToSimulationVariables> | undefined;
          const simVariables = flatFromIr && flatFromIr.length > 0 ? flatFromIr : foresightVariablesToSimulationVariables(variablesRecord);
          const needsClarify = output.needsClarify === true;

          // #3 — when planner flagged unknowns, do NOT auto-run /analytics overlay.
          // The clarify chips render in the tool card and the user picks one.
          if (needsClarify) {
            toast.message("Need a couple more inputs", {
              description: "Tap a chip below to fill in the missing piece.",
            });
            return;
          }

          simStore.startSimulation(scenario, simVariables, timeframeMonths, ir);
          setTimeout(() => {
            setOpen(false);
            router.push("/app/analytics");
          }, 4500);
          toast.loading("Running foresight simulation...", {
            id: "foresight-sim",
            description: scenario,
          });

          if (ir) {
            toast.success("Regenerating analytics", {
              id: "foresight-sim",
              description: ir.scenarioLabel || scenario,
            });
            return;
          }

          const portfolio = (vaultTokens || []).map((t: Record<string, unknown>) => ({
            symbol: (t.symbol as string) || "SPL",
            amount: Number(t.amount) || 0,
            price: Number(t.price) || 0,
          }));

          fetch("/api/simulation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              portfolio:
                portfolio.length > 0
                  ? portfolio
                  : [{ symbol: "SOL", amount: 0, price: 0 }],
              variables: simVariables,
              timeframeMonths,
              granularity: "monthly",
              priceSource: "vault",
            }),
          })
            .then((r) =>
              r.ok
                ? r.json()
                : r
                    .json()
                    .then((err: { error?: string }) =>
                      Promise.reject(new Error(err.error || "Simulation failed")),
                    ),
            )
            .then((simResult: SimulationResult) => {
              simStore.setResult(simResult);
              const pct = simResult.summary?.deltaPercent ?? 0;
              const delta = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
              toast.success("Foresight simulation ready", {
                id: "foresight-sim",
                description: `${scenario} • ${delta} projected`,
              });
            })
            .catch((err) => {
              const msg = err instanceof Error ? err.message : "Simulation failed";
              simStore.setError(msg);
              toast.error("Simulation failed", { id: "foresight-sim", description: msg });
            });
        }
      }
    },
  });

  const isStreaming = status === "streaming" || status === "submitted";
  const agentBusy = isStreaming || submitPulse;

  useEffect(() => {
    if (!isStreaming) setSubmitPulse(false);
  }, [isStreaming]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    setOpen(false);
    setMessages([]);
    setPromptMode("auto");
    setSubmitPulse(false);
  }, [setMessages]);

  const handleModalKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const root = modalPanelRef.current;
    if (!root) return;
    const sel =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const items = [...root.querySelectorAll<HTMLElement>(sel)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || (active && !root.contains(active))) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  // ─── Effects ───────────────────────────────────────────────────────────────

  // Auto-scroll to latest message
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Stream tool-call progress into the active Plan block as it materializes.
  useEffect(() => {
    const planId = activePlanBlockIdRef.current;
    if (!canvas || !planId) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    const toolParts = getToolParts(last);
    if (toolParts.length === 0) return;
    const steps = toolParts.map((p) => {
      const out =
        p.state === "output-available"
          ? (p.output as Record<string, unknown> | undefined)
          : undefined;
      const failed = out?.success === false;

      // Derive sub-steps from common output fields so the AgentsRail can light
      // up the pipeline agents (Simulation Firewall, Route Sim, Risk, MEV)
      // that ran inside this single tool call.
      const subSteps: Array<{ title: string; status: string }> = [];
      if (out) {
        if (out.firewallChecks && typeof out.firewallChecks === "object") {
          const checks = out.firewallChecks as Record<string, string>;
          const fwFailed = Object.values(checks).some((v) => v === "fail");
          subSteps.push({
            title: "simulation_firewall",
            status: fwFailed ? "failed" : "success",
          });
        }
        if (typeof out.simulationPassed === "boolean") {
          subSteps.push({
            title: "route_simulator",
            status: out.simulationPassed ? "success" : "failed",
          });
        }
        if (out.riskLevel) {
          subSteps.push({
            title: "risk_sentinel",
            status: out.riskLevel === "critical" || out.riskLevel === "high" ? "failed" : "success",
          });
        }
        if (out.route || out.routePlan) {
          subSteps.push({ title: "mev_guard", status: "success" });
        }
        if (out.inputToken || out.outputToken || out.inputMint || out.outputMint) {
          subSteps.push({ title: "token_resolver", status: "success" });
        }
      }

      return {
        title: String(p.toolName ?? "step"),
        detail: typeof out?.message === "string" ? (out.message as string) : undefined,
        status: failed ? "failed" : p.state === "output-available" ? "success" : "running",
        subSteps,
      };
    });
    canvas.updateBlock(planId, {
      payload: {
        status: "running",
        summary: `Running ${steps.length} step${steps.length === 1 ? "" : "s"}…`,
        steps,
      },
    });
  }, [messages, canvas]);

  // Auto-focus input within 150ms of opening (Requirement 1.7)
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Keyboard shortcuts: Cmd+K toggle, Escape close (Requirements 1.2, 1.3, 16.1)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, handleClose]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    setPromptMode(parsePromptModeFromInput(val));
  }, []);

  const handleFormSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || agentBusy) return;
      const text = input.trim();
      setInput("");
      setPromptMode("auto");
      setSubmitPulse(true);

      // NOTE: We intentionally do NOT spawn a canvas Plan block on every
      // command — it floods /app with one card per chat message. Tool
      // activity now renders inline in the CommandBar thread. Canvas
      // blocks should only be created by explicit user actions
      // (e.g. "pin to dashboard").

      try {
        await sendMessage(
          { text },
          {
            body: {
              walletAddress: publicKey?.toBase58() || "",
              vaultAddress: activeVault || null,
              vaultState: { tokens: vaultTokens || [] },
              walletState: { balances: vaultTokens || [] },
            },
          },
        );
      } catch (err) {
        console.error("[CommandBar] Send error:", err);
        const planId = activePlanBlockIdRef.current;
        if (canvas && planId) {
          canvas.updateBlock(planId, {
            subtitle: "Failed",
            payload: {
              status: "error",
              summary: err instanceof Error ? err.message : "Command failed.",
            },
          });
        }
      }
    },
    [input, agentBusy, sendMessage, vaultTokens, publicKey, canvas, activeVault],
  );

  const handleChipClick = useCallback((text: string) => {
    setInput(text);
    setPromptMode(parsePromptModeFromInput(text));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Inline suggestion-chip click from inside the chat thread — auto-sends.
  const handleInlineChipClick = useCallback(
    async (text: string) => {
      if (agentBusy || !text.trim()) return;
      try {
        await sendMessage(
          { text },
          {
            body: {
              walletAddress: publicKey?.toBase58() || "",
              vaultAddress: activeVault || null,
              vaultState: { tokens: vaultTokens || [] },
              walletState: { balances: vaultTokens || [] },
            },
          },
        );
      } catch (err) {
        console.error("[CommandBar] Inline chip send error:", err);
      }
    },
    [agentBusy, sendMessage, publicKey, activeVault, vaultTokens],
  );

  // Programmatic submit — used by AGENT_COMMAND listeners (suggestion buttons,
  // capability palette, dashboard widgets). Mirrors handleFormSubmit but runs
  // with an explicit `text` argument instead of reading from `input` state.
  const submitText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || agentBusy) return;
      setSubmitPulse(true);
      // Same rule as handleFormSubmit: do NOT auto-create a canvas Plan
      // block per command — would flood /app.
      try {
        await sendMessage(
          { text: trimmed },
          {
            body: {
              walletAddress: publicKey?.toBase58() || "",
              vaultAddress: activeVault || null,
              vaultState: { tokens: vaultTokens || [] },
              walletState: { balances: vaultTokens || [] },
            },
          },
        );
      } catch (err) {
        console.error("[CommandBar] submitText error:", err);
        const planId = activePlanBlockIdRef.current;
        if (canvas && planId) {
          canvas.updateBlock(planId, {
            subtitle: "Failed",
            payload: { status: "error", summary: err instanceof Error ? err.message : "Command failed." },
          });
        }
      }
    },
    [agentBusy, canvas, sendMessage, publicKey, vaultTokens, activeVault],
  );

  // ─── External AGENT_COMMAND bridge ─────────────────────────────────────────
  // Suggestion buttons on the canvas (research-brief, capability palette,
  // dashboard widgets) emit AGENT_COMMAND. We open the bar, prefill or run.
  useEffect(() => {
    const off = (() => {
      if (typeof window === "undefined") return () => {};
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail as
          | { type?: string; payload?: { command?: string; prompt?: string; autoSubmit?: boolean; suggestion?: string } }
          | undefined;
        if (!detail || detail.type !== "AGENT_COMMAND") return;
        const p = detail.payload ?? {};
        const cmd = p.command || p.prompt || p.suggestion;
        if (!cmd || typeof cmd !== "string") return;
        setOpen(true);
        const auto = p.autoSubmit !== false; // default: execute
        if (auto) {
          // Defer one tick so the modal mounts before sending.
          setTimeout(() => { submitText(cmd); }, 30);
        } else {
          setInput(cmd);
          setPromptMode(parsePromptModeFromInput(cmd));
          setTimeout(() => inputRef.current?.focus(), 60);
        }
      };
      window.addEventListener("keystone-app-event", handler);
      return () => window.removeEventListener("keystone-app-event", handler);
    })();
    return off;
  }, [submitText]);

  // ─── Wallet display ────────────────────────────────────────────────────────

  const walletDisplay = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : "Not connected";

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <AnimatePresence mode="wait">
      {!open ? (
        /* ── Collapsed Floating Pill (Requirement 1.5) ── */
        <motion.div
          key="trigger"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
        >
          <button
            onClick={() => setOpen(true)}
            aria-label="Open command bar (⌘K)"
            className="flex items-center gap-3 pl-4 pr-3 py-3 rounded-full bg-background/80 backdrop-blur-xl border border-border shadow-2xl hover:border-primary/50 hover:shadow-[0_0_20px_var(--dashboard-accent-muted)] transition-all group"
          >
            <DreyvStar size={16} className="text-primary" />
            <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors mr-2">
              Ask dreyv...
              {IntentRegistry.getActive().length > 0 && (
                <span
                  className="inline-block w-1 h-1 rounded-full bg-primary animate-ping ml-1"
                  title="Agents Active"
                />
              )}
            </span>
            <div className="flex items-center gap-1 opacity-50 text-[10px] font-mono text-foreground/50 border-l border-border pl-3">
              <span>⌘</span> K
            </div>
          </button>
        </motion.div>
      ) : (
        /* ── Expanded Modal (Requirement 1.6) ── */
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="dreyv command bar"
        >
          {/* Outside click closes (Requirement 1.8) */}
          <div className="absolute inset-0" onClick={handleClose} />

          <motion.div
            layoutId="command-bar"
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            className="relative w-full max-w-[720px] bg-card border border-border rounded-2xl shadow-[0_24px_70px_-20px_rgba(76,29,149,0.25)] overflow-hidden max-h-[90dvh] sm:max-h-[85vh]"
          >
            {/* Soft violet aura — Stripe-inspired light theme */}
            <div className="absolute inset-0 z-0 pointer-events-none rounded-2xl ring-1 ring-violet-200/60" />
            <div className="absolute -inset-1 bg-gradient-to-br from-violet-400/30 via-fuchsia-300/15 to-transparent rounded-3xl blur-2xl opacity-60 pointer-events-none" />

            <div className="relative z-10 flex flex-col max-h-[90dvh] sm:max-h-[85vh] overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch]">
              {/* ── Pipeline header (intent + specialist + recall) ── */}
              {messages.length > 0 && (
                <PipelineHeader
                  lastUserPrompt={
                    [...messages]
                      .reverse()
                      .find((m) => m.role === "user")
                      ?.parts?.flatMap((p) =>
                        p.type === "text" ? [(p as { text: string }).text] : [],
                      )
                      .join(" ") ?? null
                  }
                  wallet={publicKey?.toBase58() ?? null}
                  activeSpecialist={activeSpecialist}
                  busy={agentBusy}
                />
              )}

              <div className="flex items-center justify-end gap-2 px-4 pt-2">
                <ActiveSubagentsBadge />
              </div>

              <PendingApprovalsBanner wallet={publicKey?.toBase58() ?? null} />

              {/* ── Chat thread or empty state ── */}
              {messages.length === 0 ? (
                <EmptyState onChipClick={handleChipClick} />
              ) : (
                <div
                  ref={chatContainerRef}
                  className="flex-1 flex flex-col gap-2 py-4 min-h-[200px] max-h-[calc(85vh-130px)] overflow-y-auto overflow-x-hidden scrollbar-transparent"
                >
                  {messages.map((m, i) => {
                    const isLast = i === messages.length - 1;
                    return (
                      <ChatMessage
                        key={m.id}
                        message={m}
                        tokenLogos={TOKEN_LOGOS}
                        onSign={handleSignTransactions}
                        isStreaming={isLast && agentBusy}
                        onChipClick={handleInlineChipClick}
                      />
                    );
                  })}

                  {/* Streaming indicator (Requirement 3.1) */}
                  {agentBusy &&
                    messages[messages.length - 1]?.role !== "assistant" && (
                      <div className="flex items-center gap-2 px-2 text-muted-foreground">
                        <div className="flex items-center gap-1.5 text-xs">
                          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-ping" />
                          <span className="font-mono text-[10px] uppercase">
                            Processing…
                          </span>
                        </div>
                      </div>
                    )}

                  <div className="h-2" />
                </div>
              )}

              {/* ── Live specialist handoff stream (Phase 5.3) ── */}
              <HandoffStream
                wallet={publicKey?.toBase58() ?? null}
                streaming={agentBusy}
                onActiveSpecialistChange={setActiveSpecialist}
              />

              {/* ── Input bar ── */}
              <form
                onSubmit={handleFormSubmit}
                className={`flex items-center px-5 py-4 border-t border-border bg-card ${
                  messages.length === 0 ? "border-t-0" : ""
                }`}
              >
                <DreyvStar
                  size={18}
                  className={`text-primary mr-3 shrink-0 ${agentBusy ? "animate-spin" : ""}`}
                />
                <input
                  ref={inputRef}
                  value={input}
                  onChange={handleInputChange}
                  disabled={agentBusy}
                  placeholder={
                    messages.length === 0
                      ? 'Describe your intent (e.g., "Swap 500 SOL to USDC")…'
                      : "Follow up or issue a new command…"
                  }
                  aria-label="Command input"
                  className="flex-1 bg-transparent text-base font-medium text-foreground placeholder:text-muted-foreground/50 outline-none disabled:opacity-50"
                />
                {/* Submit button — disabled + pulsing while streaming (Requirement 3.7) */}
                <button
                  type="submit"
                  disabled={agentBusy || !input.trim()}
                  aria-label="Send command"
                  className="ml-3 p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed relative"
                >
                  {agentBusy ? (
                    <span className="absolute inset-0 rounded-lg bg-primary/20 animate-pulse" />
                  ) : null}
                  <Send size={16} />
                </button>
              </form>

              {/* ── Status footer ── */}
              <div className="px-5 py-2.5 bg-muted/30 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
                      agentBusy
                        ? "bg-primary animate-ping"
                        : chatError
                          ? "bg-red-400"
                          : "bg-emerald-400 animate-pulse"
                    }`}
                  />
                  <span className="font-mono">
                    {agentBusy
                      ? "AGENT WORKING…"
                      : chatError
                        ? "ERROR"
                        : messages.length > 0
                          ? "READY"
                          : "AI AGENT LISTENING"}
                  </span>

                  {/* PromptMode badge (Requirement 2.6) */}
                  {promptMode !== "auto" && (
                    <span
                      className={`px-1.5 py-0.5 rounded font-bold uppercase tracking-wide ${
                        promptMode === "build"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-blue-500/15 text-blue-400"
                      }`}
                    >
                      {promptMode}
                    </span>
                  )}

                  {/* Wallet address (Requirement 13.4) */}
                  <span className="text-foreground/30 font-mono">{walletDisplay}</span>
                </div>

                <div className="flex items-center gap-3">
                  {messages.length > 0 && (
                    <button
                      onClick={() => setMessages([])}
                      className="hover:text-foreground transition-colors"
                    >
                      Clear
                    </button>
                  )}
                  <span>
                    <kbd className="font-semibold text-foreground">Enter</kbd> to send
                    {" · "}
                    <kbd className="font-semibold text-foreground">Esc</kbd> to close
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
