"use client";

import React, { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useConnection, useWallet } from "@/lib/wallet/compat";
import { useAccount } from "wagmi";
import { SquadsClient } from "@/lib/squads";
import { PublicKey } from "@solana/web3.js";
import { toast } from "@/lib/toast-notifications";
import { useImportedTokens } from "@/lib/hooks/useImportedTokens";

export type ChainKey = "solana" | "evm";

export interface ActiveChainSelection {
    chain: ChainKey;
    address: string | null;
    chainId?: number | null;
}

const CHAIN_STORAGE_KEY = "keystone_active_chain";

const STAKE_PROGRAM_ID = new PublicKey("Stake11111111111111111111111111111111111111");

export interface StakeAccountInfo {
    pubkey: string;
    lamports: number;        // total lamports in the account
    activeLamports: number;  // delegated stake amount
    rewardLamports: number;  // estimated unclaimed rewards (approximation)
    validator: string;       // vote account pubkey
    status: "active" | "activating" | "deactivating" | "inactive";
    activationEpoch: string;
    deactivationEpoch: string;
}

const VAULT_STORAGE_KEY = "keystone_active_vault";

export interface RegisteredVault {
    address: string;
    label: string;
    isMultisig: boolean;
    kind: "connected" | "watch" | "multisig";
    createdAt?: string;
}

interface VaultContextType {
    activeVault: string | null;
    setActiveVault: (address: string | null) => void;
    disconnectVault: () => void;
    /** D1 — current chain the user is operating on. Solana is the default. */
    activeChain: ChainKey;
    /** D1 — address of the currently-selected chain (Solana base58 or EVM 0x...). */
    activeChainAddress: string | null;
    /** D1 — EVM chain id when activeChain==="evm" (defaults to mainnet). */
    activeChainId: number | null;
    /** D1 — let consumers switch chain without throwing if EVM isn't linked. */
    setActiveChain: (chain: ChainKey) => void;
    /** D1 — EVM address connected via RainbowKit (lower-cased). */
    evmAddress: string | null;
    vaultBalance: number | null;
    vaultTokens: any[];
    vaultValue: number | null; // Total USD Value (includes staked SOL)
    vaultChange24h: number | null; // Weighted 24h % change
    vaultConfig: { threshold: number; members: number } | null;
    proposals: any[];
    recentTransactions: any[];
    stakeAccounts: StakeAccountInfo[]; // native Solana stake accounts
    totalStakedSol: number; // total staked SOL (not lamports — already in SOL units)
    loading: boolean;
    refresh: () => Promise<void>;
    sqClient: SquadsClient | null;
    isMultisig: boolean; // true when connected address is a Squads multisig
    importedMints: string[]; // user-imported token mints that bypass spam filter
    // Phase 5 — multi-vault registry
    registeredVaults: RegisteredVault[];
    registryLoading: boolean;
    registryError: string | null;
    tierLimit: { tier: string; limit: number; used: number } | null;
    refreshRegistry: () => Promise<void>;
    addVault: (input: { address: string; label?: string; kind?: "connected" | "watch" | "multisig" }) => Promise<{ ok: true; vault: RegisteredVault } | { ok: false; error: string; code?: string }>;
    renameVault: (address: string, label: string) => Promise<boolean>;
    removeVault: (address: string) => Promise<boolean>;
}

const VaultContext = createContext<VaultContextType | undefined>(undefined);

export function VaultProvider({ children }: { children: React.ReactNode }) {
    const { connection } = useConnection();
    const wallet = useWallet();
    const { address: evmAccount, chainId: evmChainId, isConnected: evmIsConnected } = useAccount();
    const evmAddress = useMemo(
        () => (evmIsConnected && evmAccount ? evmAccount.toLowerCase() : null),
        [evmIsConnected, evmAccount],
    );

    // D1 — chain switcher state. Defaults to Solana so all existing call sites
    // keep working. Gets bumped to "evm" when the user explicitly switches.
    const [activeChain, setActiveChainState] = useState<ChainKey>("solana");
    useEffect(() => {
        try {
            const stored = localStorage.getItem(CHAIN_STORAGE_KEY);
            if (stored === "evm" || stored === "solana") setActiveChainState(stored);
        } catch { /* ignore */ }
    }, []);
    const setActiveChain = useCallback((chain: ChainKey) => {
        setActiveChainState(chain);
        try { localStorage.setItem(CHAIN_STORAGE_KEY, chain); } catch { /* ignore */ }
    }, []);

    // Rehydrate from localStorage so vault persists across navigation + refresh
    const [activeVault, setActiveVaultRaw] = useState<string | null>(null);
    const [hydrated, setHydrated] = useState(false);

    // Hydrate once on mount (client-only)
    // Try localStorage first for instant load, then validate against server
    useEffect(() => {
        try {
            const stored = localStorage.getItem(VAULT_STORAGE_KEY);
            if (stored) setActiveVaultRaw(stored);
        } catch { }
        setHydrated(true);

        // Fetch persisted vaults from server to ensure localStorage is in sync
        fetch("/api/vault")
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (!data?.vaults?.length) return;
                // If no vault in localStorage, use the first saved one
                const stored = localStorage.getItem(VAULT_STORAGE_KEY);
                if (!stored && data.vaults[0]?.address) {
                    setActiveVaultRaw(data.vaults[0].address);
                    try { localStorage.setItem(VAULT_STORAGE_KEY, data.vaults[0].address); } catch {}
                }
            })
            .catch(() => {}); // Silently fail — localStorage is the primary source
    }, []);

    // Persist-aware setter
    const setActiveVault = (address: string | null) => {
        setActiveVaultRaw(address);
        try {
            if (address) localStorage.setItem(VAULT_STORAGE_KEY, address);
            else localStorage.removeItem(VAULT_STORAGE_KEY);
        } catch { }
    };

    // Full disconnect — clears address + all cached data
    const disconnectVault = () => {
        setActiveVaultRaw(null);
        setVaultBalance(null);
        setVaultValue(null);
        setVaultChange24h(null);
        setVaultConfig(null);
        setVaultTokens([]);
        setProposals([]);
        setRecentTransactions([]);
        setStakeAccounts([]);
        setTotalStakedSol(0);
        setIsMultisig(false);
        try { localStorage.removeItem(VAULT_STORAGE_KEY); } catch { }
    };
    const [vaultBalance, setVaultBalance] = useState<number | null>(null);
    const [vaultValue, setVaultValue] = useState<number | null>(null);
    const [vaultChange24h, setVaultChange24h] = useState<number | null>(null);
    const [vaultConfig, setVaultConfig] = useState<{ threshold: number; members: number } | null>(null);
    const [vaultTokens, setVaultTokens] = useState<any[]>([]);
    const [proposals, setProposals] = useState<any[]>([]);
    const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
    const [stakeAccounts, setStakeAccounts] = useState<StakeAccountInfo[]>([]);
    const [totalStakedSol, setTotalStakedSol] = useState(0);
    const [loading, setLoading] = useState(false);
    const [isMultisig, setIsMultisig] = useState(false);
    // Monotonic counter to guard against stale refresh results
    const refreshVersionRef = useRef(0);
    const { importedMints } = useImportedTokens();

    // ── Phase 5 — multi-vault registry ───────────────────────────────
    const [registeredVaults, setRegisteredVaults] = useState<RegisteredVault[]>([]);
    const [registryLoading, setRegistryLoading] = useState(false);
    const [registryError, setRegistryError] = useState<string | null>(null);
    const [tierLimit, setTierLimit] = useState<{ tier: string; limit: number; used: number } | null>(null);

    const refreshRegistry = React.useCallback(async () => {
        setRegistryLoading(true);
        setRegistryError(null);
        try {
            const res = await fetch("/api/vault");
            if (!res.ok) {
                if (res.status === 401) { setRegisteredVaults([]); return; }
                throw new Error(`registry_${res.status}`);
            }
            const data = await res.json();
            const rows: RegisteredVault[] = Array.isArray(data?.vaults)
                ? data.vaults.map((v: any) => ({
                    address: v.address,
                    label: v.label ?? "My Wallet",
                    isMultisig: !!v.isMultisig,
                    kind: (v.kind === "watch" || v.kind === "multisig" || v.kind === "connected")
                        ? v.kind
                        : v.isMultisig ? "multisig" : "connected",
                    createdAt: v.createdAt ?? undefined,
                }))
                : [];
            setRegisteredVaults(rows);
        } catch (e: any) {
            setRegistryError(e?.message ?? "registry_failed");
        } finally {
            setRegistryLoading(false);
        }
    }, []);

    useEffect(() => { refreshRegistry(); }, [refreshRegistry]);

    const addVault = React.useCallback(async (input: { address: string; label?: string; kind?: "connected" | "watch" | "multisig" }) => {
        try {
            const res = await fetch("/api/vault", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    address: input.address,
                    label: input.label,
                    kind: input.kind ?? "watch",
                    isMultisig: input.kind === "multisig",
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 403 && data?.error?.code === "VAULT_LIMIT_REACHED") {
                setTierLimit({ tier: data.tier, limit: data.limit, used: data.currentCount });
                return { ok: false as const, error: data.error.message, code: "VAULT_LIMIT_REACHED" };
            }
            if (!res.ok || !data?.vault) {
                return { ok: false as const, error: data?.error?.message ?? "Failed to add wallet" };
            }
            await refreshRegistry();
            const v: RegisteredVault = {
                address: data.vault.address,
                label: data.vault.label,
                isMultisig: !!data.vault.isMultisig,
                kind: data.vault.kind ?? (data.vault.isMultisig ? "multisig" : "connected"),
                createdAt: data.vault.createdAt,
            };
            return { ok: true as const, vault: v };
        } catch (e: any) {
            return { ok: false as const, error: e?.message ?? "network_error" };
        }
    }, [refreshRegistry]);

    const renameVault = React.useCallback(async (address: string, label: string) => {
        const res = await fetch(`/api/vault/${encodeURIComponent(address)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label }),
        });
        if (!res.ok) return false;
        setRegisteredVaults((prev) => prev.map((v) => (v.address === address ? { ...v, label } : v)));
        return true;
    }, []);

    const removeVault = React.useCallback(async (address: string) => {
        const res = await fetch(`/api/vault/${encodeURIComponent(address)}`, { method: "DELETE" });
        if (!res.ok) return false;
        setRegisteredVaults((prev) => prev.filter((v) => v.address !== address));
        if (activeVault === address) {
            setActiveVaultRaw(null);
            try { localStorage.removeItem(VAULT_STORAGE_KEY); } catch {}
        }
        return true;
    }, [activeVault]);


    // Stabilize sqClient by tracking the underlying RPC endpoint string +
    // wallet pubkey. The wallet-adapter often hands us a NEW Connection
    // object on every render of ConnectionProvider (when endpoint switches),
    // which would otherwise re-create sqClient and re-fire the refresh effect
    // on every render → "Maximum update depth exceeded" loop.
    const endpointKey = (connection as any)?._rpcEndpoint || "default";
    const walletKey = wallet?.publicKey?.toBase58() || "anon";
    const sqClient = useMemo(() => {
        if (!connection) return null;
        return new SquadsClient(connection, wallet);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endpointKey, walletKey]);

    const refresh = async () => {
        if (!sqClient || !activeVault) return;
        const version = ++refreshVersionRef.current;
        setLoading(true);

        const rpcEndpoint = (connection as any)?._rpcEndpoint || "unknown";

        const errors: string[] = [];

        try {
            // Execute fetches in parallel but safely handle individual failures
            const [balanceResult, tokensResult, proposalsResult, configResult, txResult, stakeResult] = await Promise.allSettled([
                sqClient.getVaultBalance(activeVault),
                sqClient.getVaultTokens(activeVault),
                sqClient.getProposals(activeVault),
                sqClient.getVault(activeVault),
                sqClient.getRecentTransactions(activeVault, 12),
                // Fetch native stake accounts (delegated SOL)
                (async () => {
                    const vaultPubkey = new PublicKey(activeVault);
                    // Query stake accounts where this address is the withdrawer (most reliable authority)
                    const accounts = await connection.getParsedProgramAccounts(STAKE_PROGRAM_ID, {
                        filters: [
                            { dataSize: 200 }, // Stake account data is 200 bytes
                            { memcmp: { offset: 44, bytes: vaultPubkey.toBase58() } }, // authorized.withdrawer
                        ],
                    });

                    const parsed: StakeAccountInfo[] = [];
                    for (const acc of accounts) {
                        try {
                            const data = (acc.account.data as any)?.parsed;
                            if (!data?.info?.stake?.delegation) continue;

                            const delegation = data.info.stake.delegation;
                            const meta = data.info.meta;
                            const activeLamports = Number(delegation.stake) || 0;
                            const totalLamports = acc.account.lamports;
                            const rentExempt = Number(meta?.rentExemptReserve) || 0;
                            const deactivationEpoch = delegation.deactivationEpoch;

                            let status: StakeAccountInfo["status"] = "active";
                            if (deactivationEpoch !== "18446744073709551615") {
                                status = "deactivating";
                            }

                            parsed.push({
                                pubkey: acc.pubkey.toBase58(),
                                lamports: totalLamports,
                                activeLamports,
                                rewardLamports: Math.max(0, totalLamports - activeLamports - rentExempt),
                                validator: delegation.voter,
                                status,
                                activationEpoch: delegation.activationEpoch,
                                deactivationEpoch,
                            });
                        } catch {
                            // Skip malformed accounts
                        }
                    }
                    return parsed;
                })()
            ]);

            // Handle Balance
            const balance = balanceResult.status === "fulfilled" ? balanceResult.value : 0;
            if (balanceResult.status === "rejected") {
                const msg = `Balance fetch failed: ${balanceResult.reason?.message || balanceResult.reason}`;
                console.warn(`[VaultSync] ${msg}`);
                errors.push(msg);
            }

            // Handle Tokens
            const rawTokens = tokensResult.status === "fulfilled" ? tokensResult.value : [];
            if (tokensResult.status === "rejected") {
                const msg = `Token fetch failed: ${tokensResult.reason?.message || tokensResult.reason}`;
                console.warn(`[VaultSync] ${msg}`);
                errors.push(msg);
            }

            // Handle Proposals
            const props = proposalsResult.status === "fulfilled" ? proposalsResult.value : [];
            if (proposalsResult.status === "rejected") {
                console.warn(`[VaultSync] Proposals fetch failed (non-critical):`, proposalsResult.reason);
            }

            // Handle Recent Transactions
            const txs = txResult.status === "fulfilled" ? txResult.value : [];
            if (txResult.status === "rejected") {
                console.warn(`[VaultSync] Transactions fetch failed (non-critical):`, txResult.reason);
            }
            setRecentTransactions(txs);

            // Handle Stake Accounts
            const stakeAccts = stakeResult.status === "fulfilled" ? stakeResult.value : [];
            if (stakeResult.status === "rejected") {
                console.warn(`[VaultSync] Stake accounts fetch failed (non-critical):`, stakeResult.reason);
            } else {
                const stakedSolTotal = stakeAccts.reduce((acc, s) => acc + s.activeLamports, 0) / 1e9;
                const rewardSolTotal = stakeAccts.reduce((acc, s) => acc + s.rewardLamports, 0) / 1e9;
            }
            setStakeAccounts(stakeAccts);

            // Surface RPC errors to user
            if (errors.length > 0) {
                const isRateLimit = errors.some(e => /429|403|rate|limit|Too Many/i.test(e));
                toast.error(isRateLimit ? "RPC rate-limited" : "Vault sync partially failed", {
                    id: "vault-sync-error",
                    description: isRateLimit
                        ? "Public Solana RPC is rate-limited. Set NEXT_PUBLIC_SOLANA_RPC_URL in .env.local (Helius free tier recommended)."
                        : errors[0],
                    duration: 8000,
                });
            }

            // Fetch Prices/Metadata for tokens we successfully retrieved
            const mints = [...new Set(rawTokens.map(t => t.mint))];
            const solMint = "So11111111111111111111111111111111111111112";
            if (!mints.includes(solMint)) mints.push(solMint);

            let metadata: Record<string, { price: number; symbol?: string; name?: string; logo?: string; change24h?: number }> = {};
            try {
                metadata = await sqClient.getTokenMetadata(mints);
            } catch (pricingError) {
                console.warn("[VaultSync] Pricing/Metadata API failed:", pricingError);
                toast.warning("Price data unavailable", { id: "vault-price-warn", description: "DexScreener API failed. Token values may show as $0." });
            }

            // Unify SOL and WSOL
            const wsolAccount = rawTokens.find(t => t.mint === solMint);
            const nativeBalance = balance;
            const wsolBalance = wsolAccount ? wsolAccount.amount : 0;
            const totalSolBalance = nativeBalance + wsolBalance;

            const otherTokens = rawTokens.filter(t => t.mint !== solMint);

            // Enrich Tokens
            const enrichedTokens = otherTokens.map(t => {
                const meta = metadata[t.mint] || {};
                return {
                    ...t,
                    symbol: meta.symbol || "SPL",
                    name: meta.name || "Unknown Token",
                    logo: meta.logo,
                    price: meta.price || 0,
                    change24h: meta.change24h || 0,
                    value: t.amount * (meta.price || 0)
                };
            });

            // Unified SOL Entry

            // Handle Config — detect if this is a Squads multisig or a regular wallet
            if (configResult.status === "fulfilled" && configResult.value) {
                const multisig = configResult.value as any;
                const memberCount = multisig.keys ? multisig.keys.length : (multisig.members ? multisig.members.length : 1);

                setVaultConfig({
                    threshold: Number(multisig.threshold),
                    members: memberCount
                });
                setIsMultisig(true);
            } else {
                // Regular wallet — no multisig config
                setVaultConfig(null);
                setIsMultisig(false);
            }

            const solMeta = metadata[solMint] || { symbol: "SOL", name: "Solana", price: 0, change24h: 0, logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" };
            const unifiedSolEntry = {
                mint: solMint,
                amount: totalSolBalance,
                decimals: 9,
                symbol: "SOL",
                name: "Solana",
                logo: solMeta.logo,
                price: solMeta.price || 0,
                change24h: solMeta.change24h || 0,
                value: totalSolBalance * (solMeta.price || 0)
            };

            // Show every token the wallet holds. We used to filter by metadata
            // identity, but that drops legit tokens whose price provider is slow.
            // Spam can still be hidden via the import/hide UI.
            const importedSet = new Set(importedMints);
            const recognizedTokens = enrichedTokens.filter(t => {
                if (importedSet.has(t.mint)) return true;
                // Drop only true zero-balance dust we never imported.
                return (t.amount ?? 0) > 0;
            });

            // Calculate total staked SOL value
            const stakedLamportsTotal = stakeAccts.reduce((acc, s) => acc + s.lamports, 0);
            const stakedSolAmount = stakedLamportsTotal / 1e9;
            setTotalStakedSol(stakedSolAmount);
            const stakedSolValue = stakedSolAmount * (solMeta.price || 0);

            // If there are stake accounts, add a synthetic "Staked SOL" token entry
            const allTokens = [unifiedSolEntry, ...recognizedTokens];
            if (stakedSolAmount > 0) {
                allTokens.push({
                    mint: "STAKED_SOL_NATIVE",
                    amount: stakedSolAmount,
                    decimals: 9,
                    symbol: "Staked SOL",
                    name: `Native Staking (${stakeAccts.length} account${stakeAccts.length !== 1 ? "s" : ""})`,
                    logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
                    price: solMeta.price || 0,
                    change24h: solMeta.change24h || 0,
                    value: stakedSolValue,
                });
            }

            const totalValue = allTokens.reduce((acc, t) => acc + t.value, 0);

            // Calculate Weighted 24h Change.
            // Newly-launched / illiquid tokens routinely report absurd 24h moves
            // (e.g. +4,000,000%). Feeding those raw into a value-weighted average
            // produces a nonsense headline number, so we winsorize each token's
            // move to a plausible band and only average over tokens that actually
            // reported a usable figure (weights renormalized across those).
            let weightedChange: number | null = null;
            if (totalValue > 0) {
                const CHANGE_FLOOR = -95;   // a token can lose at most ~all of its value
                const CHANGE_CEIL = 300;    // anything beyond is treated as an outlier print
                let weightBase = 0;
                let acc = 0;
                for (const t of allTokens) {
                    const raw = typeof t.change24h === "number" ? t.change24h : NaN;
                    if (!Number.isFinite(raw) || t.value <= 0) continue;
                    const clamped = Math.min(CHANGE_CEIL, Math.max(CHANGE_FLOOR, raw));
                    acc += clamped * t.value;
                    weightBase += t.value;
                }
                if (weightBase > 0) weightedChange = acc / weightBase;
            }



            // Guard: if a newer refresh started while we were awaiting, discard this result
            if (version !== refreshVersionRef.current) {
                return;
            }

            setVaultBalance(balance);
            setVaultValue(totalValue);
            setVaultChange24h(weightedChange);
            setVaultTokens(allTokens);
            setProposals(props);
            if (totalValue === 0 && balance === 0 && rawTokens.length === 0 && errors.length === 0) {
                toast.info("Vault appears empty", {
                    id: "vault-empty",
                    description: `No SOL balance or SPL tokens found at ${activeVault.slice(0, 8)}...`,
                });
            } else if (errors.length === 0 && totalValue > 0) {
                toast.success("Vault synced", {
                    id: "vault-synced",
                    description: `$${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} across ${allTokens.filter(t => t.value > 0).length} assets`,
                });
            }
        } catch (err: any) {
            console.error("[VaultSync] Critical error:", err);
            toast.error("Vault sync failed", { id: "vault-sync-critical", description: err?.message || String(err) });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (hydrated && activeVault && sqClient) {
            refresh();
        }
    }, [activeVault, sqClient, hydrated]);

    // D1 — derive {chain, address}. EVM only valid when the user has actually
    // connected an EVM wallet; otherwise we silently fall back to Solana.
    const effectiveChain: ChainKey = activeChain === "evm" && evmAddress ? "evm" : "solana";
    const activeChainAddress: string | null =
        effectiveChain === "evm" ? evmAddress : activeVault;
    const activeChainId: number | null = effectiveChain === "evm" ? (evmChainId ?? 1) : null;

    return (
        <VaultContext.Provider value={{
            activeVault,
            setActiveVault,
            disconnectVault,
            activeChain: effectiveChain,
            activeChainAddress,
            activeChainId,
            setActiveChain,
            evmAddress,
            vaultBalance,
            vaultTokens,
            vaultValue,
            vaultChange24h,
            vaultConfig,
            proposals,
            loading,
            refresh,
            sqClient,
            isMultisig,
            importedMints,
            recentTransactions,
            stakeAccounts,
            totalStakedSol,
            registeredVaults,
            registryLoading,
            registryError,
            tierLimit,
            refreshRegistry,
            addVault,
            renameVault,
            removeVault,
        }}>
            {children}
        </VaultContext.Provider>
    );
}

export const useVault = () => {
    const context = useContext(VaultContext);
    if (!context) throw new Error("useVault must be used within a VaultProvider");
    return context;
};
