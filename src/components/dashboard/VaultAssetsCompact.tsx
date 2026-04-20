"use client";

import { ArrowRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useVault } from "@/lib/contexts/VaultContext";
import { TokenAvatar } from "@/components/TokenAvatar";

interface TokenAccount {
    mint: string;
    amount: number;
    decimals: number;
    symbol?: string;
    name?: string;
    logo?: string;
    price?: number;
    value?: number;
}

export function VaultAssetsCompact({ tokens }: { tokens: TokenAccount[] }) {
    const { refresh, loading } = useVault();

    // Sort: SOL first, then by value desc
    const sortedTokens = [...tokens].sort((a, b) => {
        if (a.symbol === "SOL") return -1;
        if (b.symbol === "SOL") return 1;
        return (b.value || 0) - (a.value || 0);
    });
    const topTokens = sortedTokens.slice(0, 5); // Show top 5

    return (
        <div className="h-full min-h-[300px] w-full bg-card border border-border rounded-2xl relative overflow-hidden flex flex-col shadow-lg">
            <div className="p-6 border-b border-border flex items-center justify-between bg-background/50">
                <div>
                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Vault Assets</h3>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{tokens.length} Positions Active</p>
                </div>
                <button
                    onClick={() => refresh()}
                    disabled={loading}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors disabled:opacity-40"
                    title="Refresh vault assets"
                >
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                {tokens.length === 0 ? (
                    <div className="h-full flex items-center justify-center flex-col gap-2 text-muted-foreground opacity-50">
                        <div className="w-10 h-10 rounded-full bg-muted border border-border" />
                        <span className="text-xs">No assets found</span>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {topTokens.map((token) => (
                            <div key={token.mint} className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/50 group transition-colors">
                                <div className="flex items-center gap-3">
                                    <TokenAvatar
                                        symbol={token.symbol}
                                        mint={token.mint}
                                        logo={token.logo}
                                        size={32}
                                    />
                                    <div>
                                        <div className="text-xs font-bold text-foreground flex items-center gap-2">
                                            {token.symbol || "Unknown"}
                                            {token.name && token.name !== token.symbol && (
                                                <span className="text-[9px] text-muted-foreground font-normal truncate max-w-[80px]">
                                                    {token.name}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                                            {token.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-xs font-mono font-bold text-foreground">
                                        {token.value ? `$${token.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00"}
                                    </div>
                                    <div className="text-[10px] font-mono text-muted-foreground">
                                        {token.price ? `$${token.price.toFixed(2)}` : "-"}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="p-4 border-t border-border bg-background/50 sticky bottom-0 backdrop-blur-sm">
                <Link href="/app/treasury">
                    <button className="w-full py-2.5 rounded-lg bg-muted/50 hover:bg-muted border border-border text-xs text-center text-foreground font-bold transition-all flex items-center justify-center gap-2 group">
                        View Full Treasury
                        <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                </Link>
            </div>
        </div>
    );
}
