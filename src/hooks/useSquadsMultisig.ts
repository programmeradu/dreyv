"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@/lib/wallet/compat";
import { SquadsClient } from "@/lib/squads";
import { useBroadcastEvent, useEventListener } from "@/liveblocks.config";
import { AppEventBus } from "@/lib/events";

export function useSquadsMultisig(vaultAddress: string) {
    const { connection } = useConnection();
    const wallet = useWallet();
    const [proposals, setProposals] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const broadcast = useBroadcastEvent();

    const fetchProposals = async () => {
        if (!vaultAddress) return;
        setLoading(true);
        try {
            // Prefer mirror cache (DB) for instant render, no RPC hit.
            const mirrorRes = await fetch(`/api/squads/proposals/sync?vault=${encodeURIComponent(vaultAddress)}`);
            if (mirrorRes.ok) {
                const data = await mirrorRes.json();
                if (Array.isArray(data?.proposals) && data.proposals.length > 0) {
                    setProposals(data.proposals);
                }
            }
            // Then trigger background sync from chain → mirror.
            fetch(`/api/squads/proposals/sync`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ vaultAddress }),
            }).then(async (r) => {
                if (!r.ok) return;
                const refreshed = await fetch(`/api/squads/proposals/sync?vault=${encodeURIComponent(vaultAddress)}`);
                if (refreshed.ok) {
                    const d = await refreshed.json();
                    if (Array.isArray(d?.proposals)) setProposals(d.proposals);
                }
            }).catch(() => {});
        } catch (error) {
            console.error("Failed to fetch proposals", error);
        } finally {
            setLoading(false);
        }
    };

    // Listen for signature events from others
    useEventListener(({ event }) => {
        if (event.type === "PROPOSAL_SIGNED") {
            AppEventBus.emit("UI_NOTIFICATION", {
                message: ` ${event.payload.signer} just signed Proposal #${event.payload.proposalId}`,
            });
            fetchProposals();
        }
        if (event.type === "PROPOSAL_REJECTED") {
            AppEventBus.emit("UI_NOTIFICATION", {
                message: ` ${event.payload.signer} rejected Proposal #${event.payload.proposalId}`,
            });
            fetchProposals();
        }
    });

    const signProposal = async (proposalId: number) => {
        if (!wallet.publicKey) return;

        try {
            const client = new SquadsClient(connection, wallet);
            // In a real app, this would be a real transaction
            const sig = await client.voteOnProposal(vaultAddress, proposalId, "Approve");

            // Broadcast to others
            broadcast({
                type: "PROPOSAL_SIGNED",
                payload: {
                    proposalId,
                    signer: wallet.publicKey.toBase58().substring(0, 4) + "...",
                },
            });

            AppEventBus.emit("UI_NOTIFICATION", {
                message: " You signed the proposal. Syncing with team...",
            });

            await fetchProposals();
            return sig;
        } catch (error) {
            console.error("Signing failed", error);
        }
    };

    const executeProposal = async (proposalId: number) => {
        if (!wallet.publicKey) return;

        try {
            const client = new SquadsClient(connection, wallet);
            const sig = await client.executeProposal(vaultAddress, proposalId);

            broadcast({
                type: "PROPOSAL_SIGNED",
                payload: { proposalId, signer: wallet.publicKey.toBase58().substring(0, 4) + "..." }
            });

            AppEventBus.emit("UI_NOTIFICATION", {
                message: " Proposal executed successfully. Awaiting finality...",
            });

            await fetchProposals();
            return sig;
        } catch (error) {
            console.error("Execution failed", error);
        }
    };

    const rejectProposal = async (proposalId: number) => {
        if (!wallet.publicKey) return;
        try {
            const client = new SquadsClient(connection, wallet);
            const sig = await client.voteOnProposal(vaultAddress, proposalId, "Reject");
            broadcast({
                type: "PROPOSAL_REJECTED",
                payload: { proposalId, signer: wallet.publicKey.toBase58().substring(0, 4) + "..." },
            });
            AppEventBus.emit("UI_NOTIFICATION", { message: "You rejected the proposal." });
            await fetchProposals();
            return sig;
        } catch (e) {
            console.error("Reject failed", e);
        }
    };

    useEffect(() => {
        fetchProposals();
    }, [vaultAddress]);

    return {
        proposals,
        loading,
        refresh: fetchProposals,
        signProposal,
        rejectProposal,
        executeProposal,
    };
}
