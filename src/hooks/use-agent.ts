import { useState, useCallback, useRef } from "react";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { ExecutionStatus, StrategyType } from "@/lib/agents/types";
import { notify } from "@/lib/notifications";

interface UseAgentOptions {
  userPublicKey?: PublicKey;
  onProgress?: (progress: number) => void;
  onStatusChange?: (status: ExecutionStatus) => void;
  /** Disable auto bell notifications for pending signature approvals. */
  disableApprovalNotifications?: boolean;
}

interface AgentExecutionResult {
  executionId: string;
  status: ExecutionStatus;
  progress: number;
  result?: any;
  error?: string;
}

/**
 * Hook for executing strategies via the agent API with real wallet signing
 */
export function useAgent(options: UseAgentOptions = {}) {
  const wallet = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<ExecutionStatus | null>(null);

  // Track approval IDs we've already pushed to the bell to avoid duplicates.
  const notifiedApprovalsRef = useRef<Set<string>>(new Set());
  // Forward-refs so notification handlers can call approve/reject without
  // creating a circular useCallback dependency.
  const approveSignatureRef = useRef<
    ((approvalId: string, signature: string) => Promise<any>) | null
  >(null);
  const rejectSignatureRef = useRef<
    ((approvalId: string) => Promise<any>) | null
  >(null);

  /** Sign a serialized transaction with the connected wallet, then approve it. */
  const signAndApprove = useCallback(
    async (approvalId: string, serializedTx?: string) => {
      if (!serializedTx) {
        return approveSignatureRef.current?.(approvalId, "");
      }
      if (!wallet.signTransaction) {
        throw new Error("Wallet does not support signing");
      }
      const buf = Uint8Array.from(atob(serializedTx), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(buf);
      const signed = await wallet.signTransaction(tx);
      const sigB64 = btoa(String.fromCharCode(...signed.serialize()));
      return approveSignatureRef.current?.(approvalId, sigB64);
    },
    [wallet]
  );

  /** Surface a pending approval to the notification bell with Approve / Reject. */
  const surfaceApproval = useCallback(
    (data: AgentExecutionResult) => {
      if (options.disableApprovalNotifications) return;
      const approvalId: string | undefined =
        (data as any).result?.approvalId ?? (data as any).approvalId;
      if (!approvalId || notifiedApprovalsRef.current.has(approvalId)) return;
      notifiedApprovalsRef.current.add(approvalId);

      const serializedTx: string | undefined =
        (data as any).result?.serializedTransaction ??
        (data as any).result?.transaction;
      const strategyName: string =
        (data as any).result?.strategy ?? (data as any).strategy ?? "Strategy";
      const summary: string =
        (data as any).result?.summary ??
        (data as any).result?.description ??
        "An agent is requesting your signature to proceed.";

      notify.signatureRequest({
        strategyName,
        summary,
        approvalId,
        onApprove: async (id) => {
          try {
            await signAndApprove(id, serializedTx);
          } catch (err) {
            // Sign failed / user cancelled → reject so the agent can clean up.
            await rejectSignatureRef.current?.(id);
            throw err;
          }
        },
        onReject: async (id) => {
          await rejectSignatureRef.current?.(id);
        },
      });
    },
    [options.disableApprovalNotifications, signAndApprove]
  );

  /**
   * Execute a strategy
   */
  const execute = useCallback(
    async (strategy: StrategyType, input: any) => {
      if (!options.userPublicKey && !wallet.publicKey) {
        const msg = "Wallet not connected";
        setError(msg);
        throw new Error(msg);
      }

      setLoading(true);
      setError(null);
      setProgress(0);

      try {
        const userPubKey = options.userPublicKey || wallet.publicKey;

        // Call agent API to execute strategy
        setProgress(50);
        const response = await fetch("/api/agentic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategy,
            input,
            userPublicKey: userPubKey?.toBase58()
          })
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Execution failed");
        }

        const data: AgentExecutionResult = await response.json();
        setExecutionId(data.executionId);
        setStatus(data.status);
        setProgress(100);
        setResult(data.result);

        if (data.status === ExecutionStatus.APPROVAL_REQUIRED) {
          surfaceApproval(data);
        }

        options.onStatusChange?.(data.status);

        return data;
      } catch (err: any) {
        const msg = err.message || "Execution failed";
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [options, wallet, surfaceApproval]
  );

  /**
   * Poll for execution status
   */
  const pollStatus = useCallback(async (id: string) => {
    let attempts = 0;
    const maxAttempts = 300; // 5 minutes with 1s polling

    const poll = async () => {
      try {
        const response = await fetch(`/api/agentic?executionId=${id}`);

        if (!response.ok) {
          if (response.status === 404) {
            setError("Execution not found");
            return;
          }
          throw new Error("Status check failed");
        }

        const data: AgentExecutionResult = await response.json();
        setStatus(data.status);
        setProgress(data.progress);
        setResult(data.result);

        if (data.status === ExecutionStatus.APPROVAL_REQUIRED) {
          surfaceApproval(data);
        }

        options.onProgress?.(data.progress);
        options.onStatusChange?.(data.status);

        // Continue polling if not in final state
        const isFinal =
          data.status === ExecutionStatus.SUCCESS ||
          data.status === ExecutionStatus.FAILED ||
          data.status === ExecutionStatus.CANCELLED;

        if (!isFinal && attempts < maxAttempts) {
          attempts++;
          setTimeout(poll, 1000);
        } else if (attempts >= maxAttempts) {
          setError("Execution timeout");
        }
      } catch (err: any) {
        setError(err.message || "Status check failed");
      }
    };

    poll();
  }, [options, surfaceApproval]);

  /**
   * Cancel execution
   */
  const cancel = useCallback(async () => {
    if (!executionId) {
      setError("No active execution");
      return;
    }

    try {
      const response = await fetch(
        `/api/agentic?executionId=${executionId}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("Cancellation failed");
      }

      setStatus(ExecutionStatus.CANCELLED);
      options.onStatusChange?.(ExecutionStatus.CANCELLED);
    } catch (err: any) {
      setError(err.message || "Cancellation failed");
    }
  }, [executionId, options]);

  /**
   * Approve signature request
   */
  const approveSignature = useCallback(
    async (approvalId: string, signature: string) => {
      try {
        const response = await fetch("/api/agentic/approve", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approvalId,
            approved: true,
            signature
          })
        });

        if (!response.ok) {
          throw new Error("Approval failed");
        }

        return await response.json();
      } catch (err: any) {
        setError(err.message || "Approval failed");
        throw err;
      }
    },
    []
  );

  /**
   * Reject signature request
   */
  const rejectSignature = useCallback(async (approvalId: string) => {
    try {
      const response = await fetch("/api/agentic/approve", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId,
          approved: false
        })
      });

      if (!response.ok) {
        throw new Error("Rejection failed");
      }

      return await response.json();
    } catch (err: any) {
      setError(err.message || "Rejection failed");
      throw err;
    }
  }, []);

  // Bind forward-refs so notification action handlers always call the latest version.
  approveSignatureRef.current = approveSignature;
  rejectSignatureRef.current = rejectSignature;

  return {
    // State
    loading,
    error,
    executionId,
    result,
    progress,
    status,

    // Methods
    execute,
    cancel,
    approveSignature,
    rejectSignature,
    pollStatus,

    // Reset
    reset: () => {
      setLoading(false);
      setError(null);
      setExecutionId(null);
      setResult(null);
      setProgress(0);
      setStatus(null);
    }
  };
}

export type { UseAgentOptions, AgentExecutionResult };

