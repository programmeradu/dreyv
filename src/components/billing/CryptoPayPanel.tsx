"use client";

/**
 * CryptoPayPanel — multi-chain manual + one-click crypto checkout.
 *
 * Default UX: Connect → Pay (signs & broadcasts in the user's wallet, then
 * auto-verifies). Manual signature paste stays as a collapsed fallback for
 * cold/hardware wallets.
 *
 * Chains: Solana (USDC/USDT/SOL) + Base/Arbitrum/Polygon/BSC (USDC/USDT).
 * EVM USDT on BSC has 18 decimals — handled per-row from the registry.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Copy, CheckCircle2, ArrowRight, Wallet, CreditCard } from "lucide-react";
import { toast } from "@/lib/toast-notifications";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { useWallet, useConnection } from "@/lib/wallet/compat";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { EVM_ENABLED } from "@/lib/feature-flags";
import { OnrampButton } from "@/components/onramp/OnrampButton";
import { isOnrampEnabled } from "@/lib/onramp/stripe";
import { StripeLogo, UsdcLogo, UsdtLogo, SolLogo, EthLogo, PhantomLogo, ASSET_LOGOS } from "@/components/billing/PaymentLogos";

type Tier = "mini" | "max";
type Chain = "solana" | "base" | "arbitrum" | "polygon" | "bsc";
type Asset = "usdc" | "usdt" | "sol";

interface Invoice {
    id: string;
    tier: Tier;
    chain: Chain;
    asset: Asset;
    amount: string;
    amountMinor: string;
    decimals: number;
    contract: string | null;
    receivingAddress: string;
    memo: string;
    expiresAt: string;
    amountUsd: number;
}

const ALL_CHAINS: { id: Chain; label: string; assets: Asset[] }[] = [
    { id: "solana",   label: "Solana",         assets: ["usdc", "usdt", "sol"] },
    { id: "base",     label: "Base",           assets: ["usdc", "usdt"]        },
    { id: "arbitrum", label: "Arbitrum",       assets: ["usdc", "usdt"]        },
    { id: "polygon",  label: "Polygon",        assets: ["usdc", "usdt"]        },
    { id: "bsc",      label: "BNB Chain",      assets: ["usdc", "usdt"]        },
];
// EVM paused — only Solana is offered until EVM_ENABLED is flipped back on.
const CHAINS = EVM_ENABLED ? ALL_CHAINS : ALL_CHAINS.filter(c => c.id === "solana");

const EVM_CHAIN_ID: Record<Exclude<Chain, "solana">, number> = {
    base: 8453, arbitrum: 42161, polygon: 137, bsc: 56,
};

/** ERC20 transfer(address,uint256) calldata + appended UTF-8 memo bytes. */
function encodeErc20TransferWithMemo(to: string, amountMinor: bigint, memo: string): `0x${string}` {
    const selector = "a9059cbb"; // keccak256("transfer(address,uint256)").slice(0,8)
    const padAddr = to.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const padAmt = amountMinor.toString(16).padStart(64, "0");
    const memoHex = Array.from(new TextEncoder().encode(memo))
        .map(b => b.toString(16).padStart(2, "0")).join("");
    return `0x${selector}${padAddr}${padAmt}${memoHex}`;
}

export function CryptoPayPanel({ onConfirmed, initialTier, walletAddress }: { onConfirmed?: (tier: Tier) => void; initialTier?: Tier; walletAddress?: string }) {
    const [tier, setTier] = useState<Tier>(initialTier ?? "mini");
    const [chain, setChain] = useState<Chain>("solana");
    const [asset, setAsset] = useState<Asset>("usdc");
    const [creating, setCreating] = useState(false);
    const [paying, setPaying] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [invoice, setInvoice] = useState<Invoice | null>(null);
    const [signature, setSignature] = useState("");
    const [showFallback, setShowFallback] = useState(false);
    const [pricing, setPricing] = useState<{ mini: number; max: number } | null>(null);

    const sol = useWallet();
    const { connection } = useConnection();
    const evm = useAccount();
    const { switchChainAsync } = useSwitchChain();
    const { data: walletClient } = useWalletClient();

    useEffect(() => {
        let cancelled = false;
        fetch("/api/billing/crypto/pricing", { cache: "no-store" })
            .then(r => r.json())
            .then(d => { if (!cancelled && d?.tiers) setPricing({ mini: d.tiers.mini.usd, max: d.tiers.max.usd }); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // Keep asset valid for the selected chain.
    useEffect(() => {
        const allowed = CHAINS.find(c => c.id === chain)!.assets;
        if (!allowed.includes(asset)) setAsset(allowed[0]);
    }, [chain, asset]);

    const tierUsd = (t: Tier) => pricing ? pricing[t].toFixed(2) : "…";
    const usd = tierUsd(tier);
    const isEvm = chain !== "solana";
    const walletConnected = isEvm ? evm.isConnected : sol.connected;

    const assetsForChain = useMemo(() => CHAINS.find(c => c.id === chain)!.assets, [chain]);

    async function startCheckout(): Promise<Invoice | null> {
        setCreating(true);
        try {
            const res = await fetch("/api/billing/crypto/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tier, chain, asset }),
            });
            const data = await res.json();
            if (!res.ok || !data.invoice) {
                toast.error(data?.error || "Failed to create invoice.");
                return null;
            }
            const inv = data.invoice as Invoice;
            setInvoice(inv);
            return inv;
        } catch {
            toast.error("Failed to start crypto checkout.");
            return null;
        } finally {
            setCreating(false);
        }
    }

    async function paySolana(inv: Invoice): Promise<string> {
        if (!sol.publicKey || !sol.sendTransaction) throw new Error("Solana wallet not connected");
        const { PublicKey, Transaction, SystemProgram, TransactionInstruction } = await import("@solana/web3.js");
        const memoIx = new TransactionInstruction({
            keys: [],
            programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
            data: Buffer.from(inv.memo, "utf8"),
        });
        const tx = new Transaction();

        if (inv.asset === "sol") {
            tx.add(SystemProgram.transfer({
                fromPubkey: sol.publicKey,
                toPubkey: new PublicKey(inv.receivingAddress),
                lamports: BigInt(inv.amountMinor),
            }));
        } else {
            // Types in this project are pinned to 0.1.x but runtime is 0.4 — cast through unknown.
            const spl = (await import("@solana/spl-token")) as unknown as {
                getAssociatedTokenAddress: (mint: unknown, owner: unknown) => Promise<unknown>;
                createAssociatedTokenAccountIdempotentInstruction: (payer: unknown, ata: unknown, owner: unknown, mint: unknown) => unknown;
                createTransferCheckedInstruction: (from: unknown, mint: unknown, to: unknown, owner: unknown, amount: bigint, decimals: number, signers?: unknown[], programId?: unknown) => unknown;
                TOKEN_PROGRAM_ID: unknown;
            };
            const mint = new PublicKey(inv.contract!);
            const recipient = new PublicKey(inv.receivingAddress);
            const fromAta = await spl.getAssociatedTokenAddress(mint, sol.publicKey);
            const toAta = await spl.getAssociatedTokenAddress(mint, recipient);
            tx.add(spl.createAssociatedTokenAccountIdempotentInstruction(sol.publicKey, toAta, recipient, mint) as Parameters<typeof tx.add>[0]);
            tx.add(spl.createTransferCheckedInstruction(fromAta, mint, toAta, sol.publicKey, BigInt(inv.amountMinor), inv.decimals, [], spl.TOKEN_PROGRAM_ID) as Parameters<typeof tx.add>[0]);
        }
        tx.add(memoIx);

        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = sol.publicKey;
        return await sol.sendTransaction(tx, connection);
    }

    async function payEvm(inv: Invoice): Promise<string> {
        if (!walletClient || !evm.address) throw new Error("EVM wallet not connected");
        const targetId = EVM_CHAIN_ID[inv.chain as Exclude<Chain, "solana">];
        if (evm.chainId !== targetId) await switchChainAsync({ chainId: targetId });
        const data = encodeErc20TransferWithMemo(inv.receivingAddress, BigInt(inv.amountMinor), inv.memo);
        const hash = await walletClient.sendTransaction({
            to: inv.contract as `0x${string}`,
            data,
            value: BigInt(0),
        });
        return hash;
    }

    /** Auto-verify with retries (gives the chain a few seconds to confirm). */
    async function autoVerify(invoiceId: string, sig: string): Promise<boolean> {
        setVerifying(true);
        try {
            for (let i = 0; i < 12; i++) {
                const res = await fetch("/api/billing/crypto/verify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ invoiceId, signature: sig }),
                });
                const data = await res.json();
                if (res.ok) {
                    toast.success(`Subscription active — ${String(data.tier).toUpperCase()}`);
                    onConfirmed?.(data.tier);
                    setInvoice(null);
                    setSignature("");
                    return true;
                }
                // tx_not_found / no_matching_transfer can mean still propagating — retry
                const transient = ["tx_not_found", "no_matching_transfer", "rpc_error"].some(r => String(data?.reason).startsWith(r));
                if (!transient) {
                    toast.error(`Verification failed: ${data?.reason || data?.error || "unknown"}`);
                    return false;
                }
                await new Promise(r => setTimeout(r, 5000));
            }
            toast.info("Still confirming — paste the tx hash below if it doesn't auto-confirm.");
            return false;
        } finally {
            setVerifying(false);
        }
    }

    async function handleConnectAndPay() {
        if (!walletConnected) {
            toast.info(isEvm ? "Connect an EVM wallet first." : "Connect a Solana wallet first.");
            return;
        }
        setPaying(true);
        try {
            const inv = invoice ?? await startCheckout();
            if (!inv) return;
            const sig = isEvm ? await payEvm(inv) : await paySolana(inv);
            setSignature(sig);
            toast.info("Transaction broadcast — waiting for confirmation…");
            await autoVerify(inv.id, sig);
        } catch (err) {
            toast.error(`Payment failed: ${(err as Error).message}`);
        } finally {
            setPaying(false);
        }
    }

    async function submitManualVerify() {
        if (!invoice || !signature.trim()) return;
        await autoVerify(invoice.id, signature.trim());
    }

    const copy = (text: string, what: string) => {
        navigator.clipboard?.writeText(text);
        toast.success(`${what} copied`);
    };

    return (
        <section className="mt-6 rounded-2xl border border-violet-100 bg-white">
            {/* Thin header strip */}
            <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-violet-100/70">
                <div className="flex items-center gap-2">
                    <DreyvStar size={9} className="text-violet-600" />
                    <span className="text-[10px] tracking-[0.22em] uppercase font-semibold text-violet-700">
                        Pay with crypto
                    </span>
                    <span className="text-[10px] font-semibold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">10% OFF</span>
                </div>
                <div className="flex items-center gap-1.5 opacity-90">
                    <UsdcLogo size={14} />
                    <UsdtLogo size={14} />
                    <SolLogo size={14} />
                    {EVM_ENABLED && <EthLogo size={14} />}
                    <span className="mx-1 h-3 w-px bg-violet-100" />
                    <PhantomLogo size={14} />
                    {isOnrampEnabled() && <><span className="mx-1 h-3 w-px bg-violet-100" /><StripeLogo size={14} /></>}
                </div>
            </div>

            {/* Compact single-row controls */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                {/* Tier */}
                <div className="inline-flex rounded-lg border border-violet-100 p-0.5">
                    {(["mini", "max"] as Tier[]).map(t => (
                        <button key={t} onClick={() => setTier(t)} disabled={!!invoice}
                            className={tier === t
                                ? "px-2.5 py-1 text-[11px] font-semibold rounded-md bg-violet-600 text-white"
                                : "px-2.5 py-1 text-[11px] font-semibold rounded-md text-slate-600 hover:text-violet-700"}>
                            {t === "mini" ? `Mini $${tierUsd("mini")}` : `Max $${tierUsd("max")}`}
                        </button>
                    ))}
                </div>

                {/* Chain (only show selector if >1 chain available) */}
                {CHAINS.length > 1 && (
                    <select
                        value={chain}
                        onChange={e => setChain(e.target.value as Chain)}
                        disabled={!!invoice}
                        className="rounded-lg border border-violet-100 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 focus:outline-none focus:border-violet-400"
                    >
                        {CHAINS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                )}

                {/* Asset */}
                <div className="inline-flex rounded-lg border border-violet-100 p-0.5">
                    {assetsForChain.map(a => {
                        const Logo = ASSET_LOGOS[a];
                        return (
                            <button key={a} onClick={() => setAsset(a)} disabled={!!invoice}
                                className={asset === a
                                    ? "inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md bg-violet-600 text-white"
                                    : "inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md text-slate-600 hover:text-violet-700"}>
                                <Logo size={11} />
                                {a.toUpperCase()}
                            </button>
                        );
                    })}
                </div>

                <div className="flex-1" />

                {/* Wallet status / connect */}
                {!walletConnected ? (
                    isEvm ? (
                        <ConnectButton accountStatus="address" chainStatus="none" showBalance={false} label="Connect" />
                    ) : (
                        <button onClick={() => sol.select(null)} className="inline-flex items-center gap-1 rounded-lg border border-violet-200 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50">
                            <Wallet size={12} /> Connect wallet
                        </button>
                    )
                ) : null}

                {/* Pay button */}
                <button
                    onClick={handleConnectAndPay}
                    disabled={creating || paying || verifying || !walletConnected}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 px-3.5 py-1.5 text-[11px] font-semibold text-white uppercase tracking-[0.06em] transition disabled:opacity-60"
                >
                    {creating ? <><Loader2 size={11} className="animate-spin" /> Invoice…</>
                        : paying ? <><Loader2 size={11} className="animate-spin" /> Sign…</>
                        : verifying ? <><Loader2 size={11} className="animate-spin" /> Confirming…</>
                        : <><ArrowRight size={11} /> Pay ${usd}</>}
                </button>

                {/* Stripe onramp inline */}
                {isOnrampEnabled() && (
                    <OnrampButton
                        asset="usdc"
                        network="solana"
                        sourceAmount={pricing ? String(pricing[tier]) : "100"}
                        label="Card top-up"
                        walletAddress={walletAddress}
                        walletNetwork="solana"
                    />
                )}
            </div>

            {/* Invoice panel — only shown when active */}
            {invoice && (
                <div className="border-t border-violet-100 bg-violet-50/30 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                        <div>
                            <div className="text-[9px] uppercase tracking-[0.18em] font-semibold text-violet-700">Invoice</div>
                            <div className="text-base font-semibold text-slate-900 leading-tight">
                                {invoice.amount} <span className="text-[11px] font-medium text-slate-500">{invoice.asset.toUpperCase()}</span>
                                <span className="ml-2 text-[10px] text-slate-500 font-normal">≈ ${invoice.amountUsd.toFixed(2)} · expires {new Date(invoice.expiresAt).toLocaleTimeString()}</span>
                            </div>
                        </div>
                        <div className="flex-1 min-w-[200px]">
                            <div className="text-[9px] uppercase tracking-[0.18em] font-semibold text-slate-500">Recipient</div>
                            <button onClick={() => copy(invoice.receivingAddress, "Address")} className="flex items-center gap-1.5 text-[11px] font-mono text-slate-800 hover:text-violet-700 truncate max-w-full">
                                <span className="truncate">{invoice.receivingAddress}</span> <Copy size={10} className="shrink-0" />
                            </button>
                        </div>
                        <div>
                            <div className="text-[9px] uppercase tracking-[0.18em] font-semibold text-slate-500">Memo</div>
                            <button onClick={() => copy(invoice.memo, "Memo")} className="flex items-center gap-1.5 text-[11px] font-mono text-slate-800 hover:text-violet-700">
                                {invoice.memo} <Copy size={10} />
                            </button>
                        </div>
                        <div className="flex items-center gap-3 ml-auto">
                            <button
                                onClick={() => setShowFallback(s => !s)}
                                className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-violet-700"
                            >
                                {showFallback ? "Hide" : "Cold wallet"}
                            </button>
                            <button
                                onClick={() => { setInvoice(null); setSignature(""); setShowFallback(false); }}
                                className="text-[10px] text-slate-500 hover:text-slate-800 uppercase tracking-[0.14em] font-semibold"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>

                    {showFallback && (
                        <div className="mt-3 flex items-center gap-2">
                            <input
                                value={signature}
                                onChange={e => setSignature(e.target.value)}
                                placeholder={isEvm ? "0x… EVM tx hash" : "Solana tx signature"}
                                className="flex-1 rounded-lg border border-violet-200 bg-white px-2.5 py-1.5 text-[11px] font-mono text-slate-800 focus:outline-none focus:border-violet-500"
                            />
                            <button
                                onClick={submitManualVerify}
                                disabled={verifying || !signature.trim()}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-1.5 text-[11px] font-semibold text-white uppercase tracking-[0.06em] transition disabled:opacity-60"
                            >
                                {verifying ? <><Loader2 size={11} className="animate-spin" /> Verifying</> : <><CheckCircle2 size={11} /> Verify</>}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
