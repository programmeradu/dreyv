"use client";
import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarUrl } from "@/lib/avatars";
import { Crown } from "lucide-react";

interface BuilderSpotlightProps {
    apps: any[];
}

export function BuilderSpotlight({ apps }: BuilderSpotlightProps) {
    // Aggregate by creator
    const map = new Map<string, { wallet: string; installs: number; apps: number }>();
    apps.forEach(a => {
        const w = a.creatorWallet;
        const cur = map.get(w) || { wallet: w, installs: 0, apps: 0 };
        cur.installs += a.installs || 0;
        cur.apps += 1;
        map.set(w, cur);
    });
    const top = Array.from(map.values())
        .sort((a, b) => b.installs - a.installs)
        .slice(0, 8);

    if (top.length === 0) return null;

    return (
        <section className="space-y-3">
            <div className="flex items-baseline justify-between">
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-foreground flex items-center gap-2">
                    <Crown size={12} className="text-primary" />
                    Builder Spotlight
                </h3>
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Top creators by installs
                </span>
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
                {top.map((b, i) => (
                    <div
                        key={b.wallet}
                        className="shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-xl border border-border/50 bg-card/40 hover:border-primary/40 hover:bg-card/70 transition-all min-w-[180px]"
                    >
                        <div className="relative">
                            <Avatar className="h-8 w-8 ring-1 ring-border/60">
                                <AvatarImage src={getAvatarUrl(b.wallet)} />
                                <AvatarFallback>B</AvatarFallback>
                            </Avatar>
                            {i === 0 && (
                                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-primary text-[8px] font-black text-black flex items-center justify-center">
                                    1
                                </span>
                            )}
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-[11px] font-mono uppercase tracking-wider text-foreground truncate">
                                {b.wallet.slice(0, 4)}…{b.wallet.slice(-4)}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                                {b.apps} app{b.apps > 1 ? 's' : ''} · {b.installs.toLocaleString()} installs
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
