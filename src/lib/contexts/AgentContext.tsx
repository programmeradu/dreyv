"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVault } from "@/lib/contexts/VaultContext";

const POLL_INTERVAL_MS = 15_000;
const STALE_AFTER_MS = 5 * 60_000;

export interface AgentProposal {
    id: string;
    kind?: string | null;
    title?: string | null;
    summary?: string | null;
    status?: string | null;
    severity?: string | null;
    riskTier?: "low" | "medium" | "high" | string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    payload?: Record<string, unknown> | null;
}

export interface AgentSubagent {
    id: string;
    label?: string | null;
    kind?: string | null;
    status?: string | null;
    lastTickAt?: string | null;
    nextTickAt?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    config?: Record<string, unknown> | null;
}

export interface AgentWatcher {
    id: string;
    chain?: string | null;
    address?: string | null;
    label?: string | null;
    status?: string | null;
    lastSeenAt?: string | null;
    lastEventAt?: string | null;
    createdAt?: string | null;
}

export interface AgentHandoff {
    id: string;
    commandId?: string | null;
    fromAgent?: string | null;
    toAgent?: string | null;
    summary?: string | null;
    status?: string | null;
    createdAt?: string | null;
    payload?: Record<string, unknown> | null;
}

export interface CommandApproval {
    id: string;
    commandId?: string | null;
    status?: string | null;
    walletAddress?: string | null;
    createdAt?: string | Date | null;
    resolvedAt?: string | Date | null;
}

export interface TxProposal {
    id: string;
    kind?: string | null;
    summary?: string | null;
    status?: string | null;
    riskLevel?: string | null;
    createdAt?: string | null;
}

export type WatcherHealth = "active" | "stale" | "errored" | "idle";

export interface AgentContextValue {
    proposals: AgentProposal[];
    subagents: AgentSubagent[];
    watchers: AgentWatcher[];
    handoffs: AgentHandoff[];
    commandApprovals: CommandApproval[];
    txProposals: TxProposal[];
    pendingApprovalCount: number;
    activeSubagentCount: number;
    watcherHealth: (AgentWatcher & { health: WatcherHealth })[];
    loading: boolean;
    lastFetchedAt: number | null;
    refresh: () => Promise<void>;
}

const defaultValue: AgentContextValue = {
    proposals: [],
    subagents: [],
    watchers: [],
    handoffs: [],
    commandApprovals: [],
    txProposals: [],
    pendingApprovalCount: 0,
    activeSubagentCount: 0,
    watcherHealth: [],
    loading: false,
    lastFetchedAt: null,
    refresh: async () => {},
};

const AgentContext = createContext<AgentContextValue>(defaultValue);

async function safeFetch<T>(url: string, fallback: T): Promise<T> {
    try {
        const res = await fetch(url, { cache: "no-store", credentials: "include" });
        if (!res.ok) return fallback;
        return (await res.json()) as T;
    } catch {
        return fallback;
    }
}

function classifyWatcher(w: AgentWatcher): WatcherHealth {
    if (w.status === "errored" || w.status === "error") return "errored";
    const ts = w.lastSeenAt ?? w.lastEventAt ?? w.createdAt;
    if (!ts) return "idle";
    const t = Date.parse(ts);
    if (!Number.isFinite(t)) return "idle";
    const age = Date.now() - t;
    if (age <= STALE_AFTER_MS) return "active";
    return "stale";
}

export function AgentProvider({ children }: { children: ReactNode }) {
    const { activeVault, activeChain, activeChainAddress, evmAddress } = useVault();
    const [state, setState] = useState<{
        proposals: AgentProposal[];
        subagents: AgentSubagent[];
        watchers: AgentWatcher[];
        handoffs: AgentHandoff[];
        commandApprovals: CommandApproval[];
        txProposals: TxProposal[];
        loading: boolean;
        lastFetchedAt: number | null;
    }>({
        proposals: [],
        subagents: [],
        watchers: [],
        handoffs: [],
        commandApprovals: [],
        txProposals: [],
        loading: false,
        lastFetchedAt: null,
    });

    const inFlight = useRef(false);

    const fetchAll = useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        // D1 — send the chain alongside the wallet so EVM-aware endpoints can
        // route to the right adapter. Solana stays the default for back-compat.
        const wallet = activeChainAddress ?? activeVault;
        const chain = activeChain;
        const params = new URLSearchParams();
        if (wallet) params.set("wallet", wallet);
        if (chain) params.set("chain", chain);
        // Always pass the EVM address (if linked) so multi-chain watchers can
        // surface findings even when the user is currently focused on Solana.
        if (evmAddress && chain !== "evm") params.set("evmWallet", evmAddress);
        const qs = params.toString();
        const qp = qs ? `?${qs}` : "";
        const handoffsQp = wallet
            ? `?wallet=${encodeURIComponent(wallet)}${chain ? `&chain=${chain}` : ""}&limit=20`
            : "";
        try {
            setState((s) => ({ ...s, loading: true }));
            const [proposalsRes, subagentsRes, watchersRes, handoffsRes, approvalsRes, txProposalsRes] = await Promise.all([
                safeFetch<{ ok: boolean; proposals?: AgentProposal[] }>(`/api/inbox/proposals${qp}`, { ok: false, proposals: [] }),
                safeFetch<{ ok: boolean; subagents?: AgentSubagent[] }>(`/api/inbox/subagents${qp}`, { ok: false, subagents: [] }),
                wallet
                    ? safeFetch<{ ok: boolean; watchers?: AgentWatcher[] }>(`/api/inbox/watchers${qp}`, { ok: false, watchers: [] })
                    : Promise.resolve({ ok: true, watchers: [] }),
                wallet
                    ? safeFetch<{ ok: boolean; handoffs?: AgentHandoff[] }>(`/api/dacs/handoffs${handoffsQp}`, { ok: false, handoffs: [] })
                    : Promise.resolve({ ok: true, handoffs: [] }),
                safeFetch<{ ok: boolean; approvals?: CommandApproval[] }>(`/api/inbox/command-approvals?status=pending`, { ok: false, approvals: [] }),
                safeFetch<{ ok: boolean; txProposals?: TxProposal[] }>(
                    `/api/inbox/tx-proposals${qp}${qp ? "&" : "?"}status=queued`,
                    { ok: false, txProposals: [] },
                ),
            ]);
            setState({
                proposals: proposalsRes.proposals ?? [],
                subagents: subagentsRes.subagents ?? [],
                watchers: watchersRes.watchers ?? [],
                handoffs: handoffsRes.handoffs ?? [],
                commandApprovals: approvalsRes.approvals ?? [],
                txProposals: txProposalsRes.txProposals ?? [],
                loading: false,
                lastFetchedAt: Date.now(),
            });
        } finally {
            inFlight.current = false;
        }
    }, [activeVault, activeChain, activeChainAddress, evmAddress]);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setInterval> | null = null;

        const tick = () => {
            if (cancelled) return;
            void fetchAll();
        };
        tick();
        timer = setInterval(tick, POLL_INTERVAL_MS);

        const onVisibility = () => {
            if (typeof document !== "undefined" && document.visibilityState === "visible") {
                tick();
            }
        };
        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", onVisibility);
        }

        return () => {
            cancelled = true;
            if (timer) clearInterval(timer);
            if (typeof document !== "undefined") {
                document.removeEventListener("visibilitychange", onVisibility);
            }
        };
    }, [fetchAll]);

    const value = useMemo<AgentContextValue>(() => {
        const watcherHealth = state.watchers.map((w) => ({ ...w, health: classifyWatcher(w) }));
        const activeSubagentCount = state.subagents.filter(
            (s) => !s.status || s.status === "active" || s.status === "running",
        ).length;
        const pendingApprovalCount =
            state.commandApprovals.filter((a) => !a.status || a.status === "pending").length +
            state.txProposals.filter((p) => !p.status || p.status === "queued").length;

        return {
            proposals: state.proposals,
            subagents: state.subagents,
            watchers: state.watchers,
            handoffs: state.handoffs,
            commandApprovals: state.commandApprovals,
            txProposals: state.txProposals,
            pendingApprovalCount,
            activeSubagentCount,
            watcherHealth,
            loading: state.loading,
            lastFetchedAt: state.lastFetchedAt,
            refresh: fetchAll,
        };
    }, [state, fetchAll]);

    return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgentContext(): AgentContextValue {
    return useContext(AgentContext);
}
