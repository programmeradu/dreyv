"use client";

import React, { useState, useEffect } from "react";
import { Key, Wallet, Package, Store, Pencil, Check, RefreshCw, Loader2, Mail, X, ShieldCheck, Fingerprint, Network } from "lucide-react";
import { useWallet, useWalletModal } from "@/lib/wallet/compat";
import { EvmConnectButton } from "@/components/EvmConnectButton";
import { useAccount } from "wagmi";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast-notifications";
import { useProfile } from "@/lib/hooks/useProfile";
import { DreyvStar } from "@/components/studio/DreyvStar";

async function loadAppStatsFromDb(wallet: string): Promise<{ appsCreated: number; appsListed: number }> {
    try {
        const { getProjects } = await import("@/actions/studio-actions");
        const projects = await getProjects(wallet);
        return {
            appsCreated: projects.length,
            appsListed: projects.filter((p: any) => p.isPublished).length,
        };
    } catch {
        return { appsCreated: 0, appsListed: 0 };
    }
}

export const ProfileView = ({ onNavigate }: { onNavigate?: (view: string) => void }) => {
    const { publicKey, connected, disconnect } = useWallet();
    const { setVisible: openWalletModal } = useWalletModal();
    const { profile, isLoading, updateProfile } = useProfile();
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState("");
    const [editingEmail, setEditingEmail] = useState(false);
    const [editEmail, setEditEmail] = useState("");
    const [stats, setStats] = useState({ appsCreated: 0, appsListed: 0 });
    const [saving, setSaving] = useState(false);

    const walletAddress = connected && publicKey ? publicKey.toBase58() : null;
    const shortWallet = walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : "Not connected";

    const displayName = profile?.displayName || "Dreyv operator";
    const avatarSeed = profile?.avatarSeed || "dreyvadmin";
    const role = profile?.role || "user";

    useEffect(() => {
        const wallet = walletAddress || "";
        loadAppStatsFromDb(wallet).then(setStats);
    }, [walletAddress]);

    const handleSaveName = async () => {
        const name = editName.trim() || "Dreyv operator";
        setSaving(true);
        const success = await updateProfile({ displayName: name });
        setSaving(false);
        if (success) { setEditing(false); toast.success("Display name updated"); }
        else toast.error("Failed to save display name");
    };

    const handleSaveEmail = async () => {
        const email = editEmail.trim();
        if (email && !email.includes("@")) { toast.error("Enter a valid email"); return; }
        setSaving(true);
        const success = await updateProfile({ email: email || null } as any);
        setSaving(false);
        if (success) { setEditingEmail(false); toast.success(email ? "Email updated" : "Email removed"); }
        else toast.error("Failed to update email");
    };

    const handleRandomizeAvatar = async () => {
        const seed = `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        setSaving(true);
        const success = await updateProfile({ avatarSeed: seed });
        setSaving(false);
        if (success) toast.success("Avatar updated");
        else toast.error("Failed to update avatar");
    };

    if (isLoading) {
        return (
            <section className="rounded-3xl border border-violet-100 bg-white p-10 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-violet-600" />
            </section>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Section header */}
            <div className="flex items-center gap-2.5">
                <DreyvStar size={10} className="text-violet-600" />
                <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Identity</span>
            </div>
            <div className="space-y-2 max-w-xl">
                <h2 className="text-[24px] sm:text-[28px] leading-[1.1] font-semibold tracking-[-0.01em] text-slate-900">
                    Your <span className="italic font-light text-violet-600">on-chain</span> identity
                </h2>
                <p className="text-[13px] text-slate-500 leading-relaxed">
                    Wallet-verified profile. The agent uses these details to attribute episodes, sign payouts, and route notifications.
                </p>
            </div>

            {/* ID Card */}
            <section className="relative rounded-3xl border border-violet-100 bg-white p-7 sm:p-8 overflow-hidden">
                <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full bg-violet-300/25 blur-3xl" />
                <div className="relative z-10 flex flex-col md:flex-row gap-7 items-center md:items-start">
                    <div className="relative shrink-0">
                        <div className="h-28 w-28 rounded-3xl bg-gradient-to-br from-violet-50 to-white border border-violet-100 p-1.5 flex items-center justify-center">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${avatarSeed}`}
                                alt="Avatar"
                                className="w-full h-full rounded-2xl bg-white"
                            />
                        </div>
                        <button
                            onClick={handleRandomizeAvatar}
                            disabled={saving}
                            className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-violet-600 hover:bg-violet-700 text-white flex items-center justify-center transition disabled:opacity-50 ring-4 ring-white"
                            title="Randomize avatar"
                        >
                            {saving ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                        </button>
                    </div>

                    <div className="flex-1 min-w-0 space-y-4 text-center md:text-left">
                        <div>
                            <div className="flex items-center justify-center md:justify-start gap-2 flex-wrap">
                                {editing ? (
                                    <div className="flex items-center gap-2">
                                        <Input
                                            value={editName}
                                            onChange={(e) => setEditName(e.target.value)}
                                            onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                                            className="h-9 text-[18px] font-semibold w-60 bg-white border-violet-200 focus-visible:ring-violet-300"
                                            autoFocus
                                        />
                                        <button onClick={handleSaveName} disabled={saving} className="h-9 px-3 rounded-full bg-violet-600 text-white text-[12px] font-semibold hover:bg-violet-700 transition flex items-center gap-1">
                                            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <h3 className="text-[24px] font-semibold tracking-[-0.01em] text-slate-900">{displayName}</h3>
                                        <button onClick={() => { setEditName(displayName); setEditing(true); }} className="p-1.5 rounded-full hover:bg-violet-50 transition">
                                            <Pencil size={12} className="text-slate-400" />
                                        </button>
                                    </>
                                )}
                                <span className="ml-1 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-violet-50 text-violet-700 text-[10px] tracking-[0.16em] uppercase font-semibold border border-violet-100">
                                    <DreyvStar size={8} /> {role}
                                </span>
                            </div>
                            <p className="mt-1.5 text-[12px] text-slate-500 font-mono">{shortWallet}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <StatCard icon={Package} label="Apps created" value={stats.appsCreated} />
                            <StatCard icon={Store} label="Marketplace listings" value={stats.appsListed} />
                        </div>
                    </div>
                </div>
            </section>

            {/* Linked credentials */}
            <section className="rounded-3xl border border-violet-100 bg-white p-7">
                <div className="flex items-center gap-2.5 mb-5">
                    <Fingerprint size={14} className="text-violet-600" />
                    <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Linked credentials</span>
                </div>
                <div className="space-y-2">
                    <CredentialItem
                        icon={Wallet}
                        label="Solana wallet"
                        value={walletAddress ? shortWallet : "No wallet connected"}
                        action={connected ? "Disconnect" : "Connect"}
                        tone={connected ? "ok" : "warn"}
                        onClick={() => {
                            if (connected) { disconnect(); toast.success("Wallet disconnected"); }
                            else openWalletModal(true);
                        }}
                    />
                    <EvmCredentialRow />
                    <CredentialItem
                        icon={Mail}
                        label="Email"
                        value={editingEmail ? (
                            <div className="flex items-center gap-2" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                <Input
                                    type="email"
                                    value={editEmail}
                                    onChange={(e) => setEditEmail(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleSaveEmail()}
                                    className="h-7 text-[12px] w-56 bg-white border-violet-200 focus-visible:ring-violet-300"
                                    placeholder="you@example.com"
                                    autoFocus
                                />
                                <button onClick={handleSaveEmail} disabled={saving} className="p-1.5 rounded-full hover:bg-violet-50">
                                    {saving ? <Loader2 size={12} className="animate-spin text-violet-600" /> : <Check size={12} className="text-violet-600" />}
                                </button>
                                <button onClick={() => setEditingEmail(false)} className="p-1.5 rounded-full hover:bg-violet-50">
                                    <X size={12} className="text-slate-400" />
                                </button>
                            </div>
                        ) : (profile?.email || "Not set — add for notifications")}
                        action={editingEmail ? "" : (profile?.email ? "Edit" : "Add")}
                        tone={profile?.email ? "ok" : "warn"}
                        onClick={() => {
                            if (!editingEmail) { setEditEmail(profile?.email || ""); setEditingEmail(true); }
                        }}
                    />
                    <CredentialItem
                        icon={Key}
                        label="API keys"
                        value={(() => {
                            try {
                                const keys = JSON.parse(localStorage.getItem("keystone_api_keys") || "[]");
                                return `${keys.length} key${keys.length !== 1 ? "s" : ""} active`;
                            } catch { return "0 keys"; }
                        })()}
                        action="Manage →"
                        tone="ok"
                        onClick={() => onNavigate?.("api")}
                    />
                    <CredentialItem
                        icon={ShieldCheck}
                        label="Security level"
                        value={connected ? "Wallet-verified identity" : "Unverified — connect wallet"}
                        action={connected ? "Verified" : "Connect"}
                        tone={connected ? "ok" : "warn"}
                        onClick={() => {
                            if (!connected) openWalletModal(true);
                            else toast.info("Identity verified via connected wallet.");
                        }}
                    />
                </div>
            </section>
        </div>
    );
};

const StatCard = ({ icon: Icon, label, value }: { icon: any; label: string; value: number | string }) => (
    <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-white to-violet-50/40 p-4">
        <div className="flex items-center gap-2 text-[10px] tracking-[0.18em] uppercase font-semibold text-slate-500">
            <Icon size={12} className="text-violet-600" /> {label}
        </div>
        <p className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-slate-900 tabular-nums">{value}</p>
    </div>
);

function EvmCredentialRow() {
    const { address, isConnected } = useAccount();
    const [linked, setLinked] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/auth/link-evm", { credentials: "include" });
                if (!cancelled && res.ok) {
                    const data = (await res.json()) as { evmWalletAddress?: string | null };
                    setLinked(data.evmWalletAddress ?? null);
                }
            } catch { /* ignore */ }
        })();
        return () => { cancelled = true; };
    }, [isConnected, address]);

    const display = isConnected && address
        ? `${address.slice(0, 6)}…${address.slice(-4)}`
        : linked
            ? `${linked.slice(0, 6)}…${linked.slice(-4)}`
            : "Not linked — read-only EVM analytics";

    const handleUnlink = async () => {
        try {
            const res = await fetch("/api/auth/link-evm", { method: "DELETE", credentials: "include" });
            if (res.ok) {
                setLinked(null);
                toast.success("EVM wallet unlinked");
            } else {
                toast.error("Could not unlink EVM wallet");
            }
        } catch {
            toast.error("Could not unlink EVM wallet");
        }
    };

    return (
        <div className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-violet-100 bg-white">
            <div className="flex items-center gap-3 min-w-0">
                <span className="h-9 w-9 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                    <Network size={15} />
                </span>
                <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-900">EVM wallet (read-only)</p>
                    <div className="text-[11px] text-slate-500 truncate font-mono">{display}</div>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <EvmConnectButton hideUntilMounted={false} />
                {linked && !isConnected && (
                    <button
                        type="button"
                        onClick={handleUnlink}
                        className="text-[11px] font-semibold tracking-[0.08em] text-amber-600 hover:text-amber-700"
                    >
                        Unlink
                    </button>
                )}
            </div>
        </div>
    );
}

const CredentialItem = ({
    icon: Icon, label, value, action, tone = "ok", onClick,
}: { icon: any; label: string; value: React.ReactNode; action: string; tone?: "ok" | "warn"; onClick?: () => void }) => (
    <button
        type="button"
        onClick={onClick}
        className="w-full text-left flex items-center justify-between gap-4 p-4 rounded-2xl border border-violet-100 bg-white hover:border-violet-300 hover:bg-violet-50/40 transition-all"
    >
        <div className="flex items-center gap-3 min-w-0">
            <span className="h-9 w-9 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                <Icon size={15} />
            </span>
            <div className="min-w-0">
                <p className="text-[13px] font-semibold text-slate-900">{label}</p>
                <div className="text-[11px] text-slate-500 truncate font-mono">{value}</div>
            </div>
        </div>
        {action && (
            <span className={`text-[11px] font-semibold tracking-[0.08em] ${tone === "ok" ? "text-violet-700" : "text-amber-600"}`}>
                {action}
            </span>
        )}
    </button>
);
