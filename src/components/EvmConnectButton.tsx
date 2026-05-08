"use client";

/**
 * EvmConnectButton — read-only EVM wallet pairing UX.
 *
 * Wraps RainbowKit's `<ConnectButton.Custom>` so we can render a slim button
 * that matches the Solana `<WalletButton>`. When the wallet connects we POST
 * the address to `/api/auth/link-evm` so it gets persisted on `users.evm_wallet_address`.
 *
 * No SIWE: this is read-only-only for the MVP — execution still happens on
 * Solana. The link is purely for analytics, watchers, and bridge-for-gas hints.
 */

import { useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Loader2, Network } from "lucide-react";
import { toast } from "@/lib/toast-notifications";

/** Mirrors RainbowKit `ConnectButton.Custom` render props (not exported from package root). */
interface EvmRKRenderProps {
    account?: {
        address: string;
        displayName: string;
        ensAvatar?: string;
        ensName?: string;
        hasPendingTransactions: boolean;
        balanceDecimals?: number;
        balanceFormatted?: string;
        balanceSymbol?: string;
        displayBalance?: string;
    };
    chain?: {
        hasIcon: boolean;
        iconUrl?: string;
        iconBackground?: string;
        id: number;
        name?: string;
        unsupported?: boolean;
    };
    mounted: boolean;
    authenticationStatus?: "loading" | "authenticated" | "unauthenticated";
    openAccountModal: () => void;
    openChainModal: () => void;
    openConnectModal: () => void;
    accountModalOpen?: boolean;
    chainModalOpen?: boolean;
    connectModalOpen?: boolean;
}

interface Props {
    /** Hide on SSR + during dehydration to avoid hydration mismatch. */
    hideUntilMounted?: boolean;
    /** Optional callback after a successful link. */
    onLinked?: (address: string) => void;
}

export function EvmConnectButton({ hideUntilMounted = true, onLinked }: Props) {
    const [mounted, setMounted] = useState(false);
    const lastLinkedRef = useRef<string | null>(null);
    const { address, isConnected } = useAccount();

    useEffect(() => {
        setMounted(true);
    }, []);

    // Persist EVM address on /api/auth/link-evm whenever the connected address
    // changes. We dedupe via lastLinkedRef so re-renders don't double-POST.
    useEffect(() => {
        if (!mounted || !isConnected || !address) return;
        const lower = address.toLowerCase();
        if (lastLinkedRef.current === lower) return;
        lastLinkedRef.current = lower;

        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/auth/link-evm", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ address: lower }),
                    credentials: "include",
                });
                if (cancelled) return;
                if (res.status === 401) return; // signed out — skip silently
                if (!res.ok) {
                    const data = await res.json().catch(() => null);
                    if (data?.error === "invalid_address") {
                        toast.error("Could not link EVM wallet (invalid address)");
                    }
                    return;
                }
                onLinked?.(lower);
            } catch {
                // Best-effort; user can retry by reconnecting.
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [mounted, address, isConnected, onLinked]);

    if (hideUntilMounted && !mounted) {
        return (
            <Button variant="outline" size="sm" className="h-8 gap-2 text-xs font-mono opacity-50">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading
            </Button>
        );
    }

    return (
        <ConnectButton.Custom>
            {({
                account,
                chain,
                openAccountModal,
                openChainModal,
                openConnectModal,
                authenticationStatus,
                mounted: rkMounted,
            }: EvmRKRenderProps) => {
                const ready = rkMounted && authenticationStatus !== "loading";
                const connected =
                    ready &&
                    !!account &&
                    !!chain &&
                    (!authenticationStatus || authenticationStatus === "authenticated");

                if (!ready) {
                    return (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-2 text-xs font-mono opacity-50"
                            disabled
                        >
                            <Loader2 className="h-3 w-3 animate-spin" />
                            EVM
                        </Button>
                    );
                }

                if (!connected) {
                    return (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={openConnectModal}
                            className="h-8 gap-2 border-border bg-background text-xs font-medium hover:bg-muted hover:text-foreground transition-colors group shadow-sm"
                        >
                            <Network className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                            Link EVM
                        </Button>
                    );
                }

                if (chain.unsupported) {
                    return (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={openChainModal}
                            className="h-8 gap-2 border-amber-300 bg-amber-50 text-xs font-medium text-amber-700"
                        >
                            <Network className="h-3.5 w-3.5" />
                            Wrong network
                        </Button>
                    );
                }

                return (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={openAccountModal}
                        className="h-8 gap-2 border-border bg-background text-xs font-mono hover:bg-muted hover:text-foreground transition-colors shadow-sm"
                    >
                        <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                        {account.displayName}
                    </Button>
                );
            }}
        </ConnectButton.Custom>
    );
}
