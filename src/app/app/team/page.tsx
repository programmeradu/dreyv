"use client";

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback, useRef, Suspense } from "react";
import {
    useOthers,
    useSelf,
    useBroadcastEvent,
    useEventListener,
    useStatus,
} from "@/liveblocks.config";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Users,
    Shield,
    Zap,
    CheckCircle2,
    Play,
    Siren,
    Radio,
    Cpu,
    Sparkles,
    UserPlus,
    Activity,
    Loader2,
    ArrowRight,
} from "lucide-react";
import { motion } from "framer-motion";
import { CollaborativeChat } from "@/components/CollaborativeChat";
import { useSquadsMultisig } from "@/hooks/useSquadsMultisig";
import { Input } from "@/components/ui/input";
import { AppEventBus } from "@/lib/events";
import { CollaborativeHeader } from "@/components/CollaborativeHeader";
import { WalletButton } from "@/components/WalletButton";
import { getAvatarUrl } from "@/lib/avatars";
import { useVault } from "@/lib/contexts/VaultContext";
import { toast } from "@/lib/toast-notifications";
import { useSearchParams } from "next/navigation";
import { useTeam } from "@/lib/hooks/useTeam";
import { TeamSwitcher } from "@/components/team/TeamSwitcher";
import { PendingInvitationsPanel } from "@/components/team/PendingInvitationsPanel";
import { CreateVaultFromTeamModal } from "@/components/team/CreateVaultFromTeamModal";
import { ProposalThread } from "@/components/team/ProposalThread";
import {
    AmbientGlow,
    Surface,
    StreamIn,
    Pill,
} from "@/components/app-shell/primitives";

// ─── Legacy invite-token interceptor ────────────────────────────────
// Kept for backwards-compat with old emails that still link to
// `/app/team?accept=<token>`. New emails go to `/accept-team-invite/<token>`.
function InviteInterceptor() {
    const searchParams = useSearchParams();
    const acceptToken = searchParams.get("accept");

    useEffect(() => {
        if (!acceptToken) return;
        (async () => {
            try {
                const res = await fetch("/api/team/accept-invite", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token: acceptToken }),
                });
                if (res.ok) {
                    toast.success("You’ve joined the team");
                    window.history.replaceState({}, document.title, window.location.pathname);
                    setTimeout(() => window.location.reload(), 1500);
                } else {
                    const err = await res.json().catch(() => ({}));
                    toast.error(err?.error || "Failed to accept invite");
                }
            } catch {
                toast.error("Failed to accept invite");
            }
        })();
    }, [acceptToken]);

    return null;
}

interface LogEntry {
    user: string;
    action: string;
    target: string;
    time: string;
}

// ─── Invite form ────────────────────────────────────────────────────
function InviteForm({ teamId }: { teamId: string | null }) {
    const [address, setAddress] = useState("");
    const [role, setRole] = useState<"viewer" | "signer" | "admin">("signer");
    const [loading, setLoading] = useState(false);

    const handleInvite = async () => {
        if (!teamId || !address) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/team/${teamId}/invite`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address, role }),
            });
            if (res.ok) {
                toast.success("Invitation sent");
                setAddress("");
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || "Could not send invite");
            }
        } catch {
            toast.error("Network error");
        } finally {
            setLoading(false);
        }
    };

    if (!teamId) {
        return (
            <p className="text-sm text-slate-500">Create a team first to invite members.</p>
        );
    }

    return (
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <Input
                type="text"
                placeholder="Wallet address or email…"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="flex-1 rounded-xl border-violet-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-violet-500"
            />
            <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-violet-500 focus:outline-none"
            >
                <option value="viewer">Viewer</option>
                <option value="signer">Signer</option>
                <option value="admin">Admin</option>
            </select>
            <button
                onClick={handleInvite}
                disabled={loading || !address}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50"
            >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                {loading ? "Sending…" : "Send invite"}
            </button>
        </div>
    );
}

// ─── Member card ────────────────────────────────────────────────────
function MemberCard({
    name,
    role,
    status,
    isSelf,
    avatar,
}: {
    name: string;
    role: string;
    status: "online" | "offline";
    isSelf?: boolean;
    avatar: string;
}) {
    return (
        <div className="flex items-center gap-3 rounded-2xl border border-violet-100 bg-white/80 p-4 transition hover:border-violet-300 hover:shadow-sm">
            <div className="relative">
                <Avatar className="h-10 w-10 ring-1 ring-violet-200">
                    <AvatarImage src={avatar} />
                    <AvatarFallback className="bg-violet-50 text-xs font-semibold text-violet-700">
                        {name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                </Avatar>
                <span
                    className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white ${
                        status === "online" ? "bg-violet-600" : "bg-slate-300"
                    }`}
                />
            </div>
            <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                    {name} {isSelf && <span className="text-slate-400">(you)</span>}
                </p>
                <p className="mt-0.5 text-[11px] uppercase tracking-wider text-violet-600">{role}</p>
            </div>
        </div>
    );
}

// ─── Activity row ───────────────────────────────────────────────────
function ActivityRow({ user, action, target, time }: LogEntry) {
    return (
        <div className="flex items-start gap-3 border-b border-violet-50 py-3 last:border-b-0">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-violet-600" />
            <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-700">
                    <span className="font-semibold text-slate-900">{user}</span>{" "}
                    <span className="text-violet-700">{action.toLowerCase()}</span>{" "}
                    <span className="text-slate-500">— {target}</span>
                </p>
            </div>
            <span className="text-[11px] tabular-nums text-slate-400">{time}</span>
        </div>
    );
}

// ─── War Room (live proposals) ──────────────────────────────────────
function WarRoom({ vaultAddress }: { vaultAddress: string }) {
    const { proposals, loading, signProposal, rejectProposal, executeProposal } = useSquadsMultisig(vaultAddress);
    const broadcast = useBroadcastEvent();
    const others = useOthers();
    const [simulating, setSimulating] = useState<number | null>(null);

    useEventListener(({ event }) => {
        if (event.type === "SIMULATION_RESULT") {
            AppEventBus.emit("UI_NOTIFICATION", {
                message: `Simulation for proposal #${event.payload.proposalId} complete.`,
            });
        }
    });

    const handleSimulate = (proposalId: number) => {
        setSimulating(proposalId);
        setTimeout(() => {
            setSimulating(null);
            broadcast({
                type: "SIMULATION_RESULT",
                payload: { proposalId, result: { success: true } },
            });
            AppEventBus.emit("UI_NOTIFICATION", {
                message: "Simulation complete. Results shared with team.",
            });
        }, 1600);
    };

    return (
        <Surface className="p-7">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                        War room
                    </p>
                    <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
                        Live proposals
                    </h3>
                </div>
                <span className="flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                    <Radio className="h-3 w-3" />
                    {others.length + 1} live
                </span>
            </div>

            <div className="mt-5 space-y-3">
                {!vaultAddress ? (
                    <p className="rounded-xl border border-dashed border-violet-200 bg-violet-50/30 p-4 text-sm text-slate-500">
                        Connect a vault from the sidebar to see live proposals.
                    </p>
                ) : loading && proposals.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-violet-600">
                        <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                ) : proposals.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-violet-200 bg-violet-50/30 p-4 text-sm text-slate-500">
                        No active proposals. When someone proposes a transaction, it’ll show up here in real time.
                    </p>
                ) : (
                    proposals.map((p: any) => {
                        // Support both mirror shape (approvals/transactionIndex) and legacy chain shape (signatures/index)
                        const txIndex = Number(p.transactionIndex ?? p.index ?? 0);
                        const approvals = Number(p.approvals ?? p.signatures ?? 0);
                        const rejections = Number(p.rejections ?? 0);
                        const threshold = Number(p.threshold ?? 1);
                        const status = String(p.status ?? "Active");
                        const ratio = threshold > 0 ? approvals / threshold : 0;
                        const ready = approvals >= threshold;
                        const executed = status === "Executed";
                        const cancelled = status === "Cancelled" || status === "Rejected";
                        const approvedBy: string[] = Array.isArray(p.approvedBy) ? p.approvedBy : [];
                        const rejectedBy: string[] = Array.isArray(p.rejectedBy) ? p.rejectedBy : [];
                        return (
                            <motion.div
                                key={txIndex}
                                layout
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="rounded-2xl border border-violet-100 bg-white p-4 transition hover:border-violet-300"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-semibold text-slate-900">
                                        Proposal #{txIndex}
                                        {p.summary && (
                                            <span className="ml-2 font-normal text-slate-500">— {p.summary}</span>
                                        )}
                                    </span>
                                    <Pill tone={executed ? "emerald" : cancelled ? "amber" : ready ? "emerald" : "violet"}>
                                        {status}
                                    </Pill>
                                </div>

                                <div className="mt-3 flex items-center gap-3">
                                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-violet-100">
                                        <div
                                            className="h-full bg-violet-600 transition-all"
                                            style={{ width: `${Math.min(100, ratio * 100)}%` }}
                                        />
                                    </div>
                                    <span className="text-xs font-semibold tabular-nums text-violet-700">
                                        {approvals}/{threshold}
                                    </span>
                                    {rejections > 0 && (
                                        <span className="text-xs font-semibold tabular-nums text-red-600">
                                            ✕ {rejections}
                                        </span>
                                    )}
                                </div>

                                {(approvedBy.length > 0 || rejectedBy.length > 0) && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {approvedBy.map((s) => (
                                            <span key={`a-${s}`} className="rounded-full bg-violet-50 px-2 py-0.5 font-mono text-[10px] text-violet-700">
                                                ✓ {s.slice(0, 4)}…{s.slice(-4)}
                                            </span>
                                        ))}
                                        {rejectedBy.map((s) => (
                                            <span key={`r-${s}`} className="rounded-full bg-red-50 px-2 py-0.5 font-mono text-[10px] text-red-700">
                                                ✕ {s.slice(0, 4)}…{s.slice(-4)}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {!executed && !cancelled && (
                                    <div className="mt-3 flex items-center gap-2">
                                        <button
                                            onClick={() => handleSimulate(txIndex)}
                                            disabled={simulating === txIndex}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-50 disabled:opacity-50"
                                        >
                                            <Play className={`h-3 w-3 ${simulating === txIndex ? "animate-pulse" : ""}`} />
                                            {simulating === txIndex ? "Simulating…" : "Simulate"}
                                        </button>
                                        {ready ? (
                                            <button
                                                onClick={() => executeProposal(txIndex)}
                                                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700"
                                            >
                                                <Zap className="h-3 w-3" />
                                                Execute
                                            </button>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => signProposal(txIndex)}
                                                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700"
                                                >
                                                    <CheckCircle2 className="h-3 w-3" />
                                                    Approve
                                                </button>
                                                <button
                                                    onClick={() => rejectProposal(txIndex)}
                                                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                                                >
                                                    Reject
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}

                                <ProposalThread vaultAddress={vaultAddress} transactionIndex={txIndex} />
                            </motion.div>
                        );
                    })
                )}
            </div>
        </Surface>
    );
}

// ─── Quorum core ────────────────────────────────────────────────────
function QuorumCore({ others, threshold = 1 }: { others: any[]; threshold?: number }) {
    const onlineSigners = others.length + 1;
    const ready = onlineSigners >= threshold;
    const pct = Math.min(100, (onlineSigners / Math.max(threshold, 1)) * 100);

    return (
        <Surface className="p-7">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                        Quorum
                    </p>
                    <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
                        {ready ? "Quorum ready" : "Waiting for signers"}
                    </h3>
                </div>
                <Pill tone={ready ? "emerald" : "amber"}>{ready ? "Ready" : "Awaiting"}</Pill>
            </div>

            <div className="mt-6 flex items-center justify-center">
                <div className="relative flex h-28 w-28 items-center justify-center">
                    <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="44" className="fill-none stroke-violet-100" strokeWidth="6" />
                        <circle
                            cx="50"
                            cy="50"
                            r="44"
                            className={`fill-none transition-all ${ready ? "stroke-violet-600" : "stroke-amber-500"}`}
                            strokeWidth="6"
                            strokeDasharray={`${(pct / 100) * 276.46} 276.46`}
                            strokeLinecap="round"
                        />
                    </svg>
                    <div className="flex flex-col items-center">
                        <span className={`text-2xl font-semibold tabular-nums ${ready ? "text-violet-700" : "text-amber-600"}`}>
                            {onlineSigners}/{threshold}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-slate-400">online</span>
                    </div>
                </div>
            </div>

            <p className="mt-5 text-center text-sm text-slate-500">
                {ready
                    ? "You have enough signers online to execute proposals."
                    : `${threshold - onlineSigners} more signer${threshold - onlineSigners === 1 ? "" : "s"} needed for quorum.`}
            </p>
        </Surface>
    );
}

// ─── Page ───────────────────────────────────────────────────────────
export default function TeamPage() {
    const connectionStatus = useStatus();
    // Detect whether realtime presence is intentionally disabled on the server
    // (e.g. LIVEBLOCKS_SECRET_KEY not configured). When that's the case the
    // client will sit in "reconnecting" forever, so we surface a friendly
    // "Solo mode" label instead of misleading the user.
    const [realtimeDisabled, setRealtimeDisabled] = useState(false);
    useEffect(() => {
        let cancelled = false;
        // Only probe if we're not already happily connected.
        if (connectionStatus === "connected") return;
        (async () => {
            try {
                const res = await fetch("/api/liveblocks-auth", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ room: "probe" }),
                });
                if (cancelled) return;
                if (res.status === 503) {
                    const body = await res.json().catch(() => ({}));
                    if (body?.code === "liveblocks_disabled") setRealtimeDisabled(true);
                }
            } catch {}
        })();
        return () => { cancelled = true; };
    }, [connectionStatus]);
    const isSpectator = connectionStatus !== "connected";
    const others = useOthers();
    const self = useSelf();
    const { activeVault, vaultConfig } = useVault();
    const { activeTeam } = useTeam();
    const vaultAddress = activeVault || "";

    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [vaultWizardOpen, setVaultWizardOpen] = useState(false);
    const logRef = useRef<HTMLDivElement>(null);

    const appendLog = useCallback((entry: Omit<LogEntry, "time">) => {
        const now = new Date();
        const time = now.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });
        setLogEntries((prev) => [{ ...entry, time }, ...prev].slice(0, 50));
    }, []);

    // Polling real DB events
    useEffect(() => {
        if (!vaultAddress) return;
        let isMounted = true;
        const fetchLogs = async () => {
            try {
                const res = await fetch(`/api/vault/${vaultAddress}/activity`);
                if (!res.ok) return;
                const data = await res.json();
                if (isMounted && Array.isArray(data)) {
                    const mapped: LogEntry[] = data.map((log: any) => ({
                        user: log.user?.name || "System",
                        action: (log.action || "").replace(/_/g, " "),
                        target: log.description || log.targetType || "vault",
                        time: new Date(log.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                        }),
                    }));
                    setLogEntries(mapped);
                }
            } catch (e) {
                console.error("Log fetch error", e);
            }
        };
        fetchLogs();
        const interval = setInterval(fetchLogs, 15_000);
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [vaultAddress]);

    // Listen to local optimistic events
    useEffect(() => {
        const unsub = AppEventBus.subscribe((event) => {
            switch (event.type) {
                case "AGENT_COMMAND":
                    appendLog({
                        user: "Agent",
                        action: "agent command",
                        target: (event.payload?.command || event.payload?.message || "executed") as string,
                    });
                    break;
                case "UI_NOTIFICATION":
                    appendLog({
                        user: "System",
                        action: "notification",
                        target: (event.payload?.message || "event") as string,
                    });
                    break;
                case "REFRESH_DASHBOARD":
                    appendLog({ user: "You", action: "refreshed", target: "dashboard data" });
                    break;
            }
        });
        return unsub;
    }, [appendLog]);

    return (
        <div className="relative min-h-screen overflow-x-hidden bg-white font-manrope text-slate-900">
            <Suspense fallback={null}>
                <InviteInterceptor />
            </Suspense>

            <AmbientGlow className="left-[-160px] top-[-200px]" />
            <AmbientGlow className="right-[-160px] top-[300px]" />

            {/* Header */}
            <header className="relative z-10 mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6">
                <div className="flex items-center gap-2.5">
                    <img
                        src="/dreyv-mark.svg"
                        alt=""
                        className="h-7 w-7 rounded-lg"
                    />
                    <span className="text-sm font-semibold tracking-tight text-slate-900">
                        dreyv<span className="text-slate-400"> · Team</span>
                    </span>
                </div>

                <div className="flex items-center gap-3">
                    <TeamSwitcher />
                    <Suspense fallback={<div className="h-8 w-24 animate-pulse rounded-full bg-violet-100" />}>
                        <CollaborativeHeader />
                    </Suspense>
                    <WalletButton />
                </div>
            </header>

            {/* Hero */}
            <section className="relative z-10 mx-auto max-w-6xl px-6 pt-2">
                <StreamIn className="space-y-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                        Team workspace
                    </p>
                    <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
                        {activeTeam?.teamName ?? "Bring your team into the treasury."}
                    </h1>
                    <p className="max-w-xl text-base text-slate-600">
                        Invite signers, see who’s online, and co-sign vault transactions together — in one calm place.
                    </p>

                    <div className="flex items-center gap-2 pt-2 text-sm text-slate-500">
                        <span
                            className={`h-1.5 w-1.5 rounded-full ${
                                isSpectator ? "bg-amber-500" : "bg-violet-600"
                            }`}
                        />
                        <span>
                            {isSpectator ? "Reconnecting…" : `${others.length + 1} online now`}
                        </span>
                    </div>
                </StreamIn>
            </section>

            {/* Main grid */}
            <section className="relative z-10 mx-auto mt-12 max-w-6xl px-6 pb-24">
                <div className="grid gap-6 lg:grid-cols-3">
                    {/* Left column: members + invite + activity */}
                    <div className="space-y-6 lg:col-span-2">
                        {/* Members */}
                        <Surface className="p-7">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                                        Members
                                    </p>
                                    <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
                                        Active operatives
                                    </h3>
                                </div>
                                <span className="flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                                    <Users className="h-3 w-3" />
                                    {others.length + 1} online
                                </span>
                            </div>

                            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
                                <MemberCard
                                    name={self?.info?.name || "You"}
                                    role="Admin · Signer"
                                    status="online"
                                    isSelf
                                    avatar={getAvatarUrl(self?.info?.name || "ME")}
                                />
                                {others.map(({ connectionId, info }) => (
                                    <MemberCard
                                        key={connectionId}
                                        name={info?.name || "Collaborator"}
                                        role="Signer"
                                        status="online"
                                        avatar={getAvatarUrl(info?.name || "Collaborator")}
                                    />
                                ))}
                            </div>

                            <div className="mt-6 border-t border-violet-100 pt-5">
                                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                                    Invite a teammate
                                </p>
                                <InviteForm teamId={activeTeam?.teamId ?? null} />
                            </div>
                        </Surface>

                        {/* Pending invitations */}
                        <PendingInvitationsPanel teamId={activeTeam?.teamId ?? null} />

                        {/* Activity */}
                        <Surface className="p-7">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                                        Activity
                                    </p>
                                    <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
                                        What happened recently
                                    </h3>
                                </div>
                                <Activity className="h-4 w-4 text-violet-500" />
                            </div>

                            <div ref={logRef} className="mt-5 max-h-[360px] overflow-y-auto">
                                {logEntries.length === 0 ? (
                                    <p className="py-6 text-center text-sm text-slate-500">
                                        Nothing yet. Activity will appear as your team takes action.
                                    </p>
                                ) : (
                                    logEntries.map((entry, idx) => (
                                        <ActivityRow key={`${entry.time}-${idx}`} {...entry} />
                                    ))
                                )}
                            </div>
                        </Surface>
                    </div>

                    {/* Right column: war room + quorum + chat */}
                    <div className="space-y-6">
                        {!activeVault && activeTeam && (
                            <Surface className="p-7 text-center">
                                <Shield className="mx-auto h-8 w-8 text-violet-500" />
                                <p className="mt-3 text-sm font-medium text-slate-900">
                                    No vault connected
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                    Deploy a Squads multisig for {activeTeam.teamName} to unlock the War Room.
                                </p>
                                <button
                                    onClick={() => setVaultWizardOpen(true)}
                                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
                                >
                                    <Shield className="h-4 w-4" /> Create vault
                                </button>
                            </Surface>
                        )}

                        <WarRoom vaultAddress={vaultAddress} />

                        <QuorumCore
                            others={others as any[]}
                            threshold={vaultConfig?.threshold ?? 1}
                        />

                        <CollaborativeChat />
                    </div>
                </div>
            </section>
            {activeTeam && (
                <CreateVaultFromTeamModal
                    open={vaultWizardOpen}
                    onOpenChange={setVaultWizardOpen}
                    teamId={activeTeam.teamId}
                    teamName={activeTeam.teamName}
                />
            )}
        </div>
    );
}
