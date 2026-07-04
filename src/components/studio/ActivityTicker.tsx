"use client";
import React from "react";
import { Marquee } from "@/components/ui/marquee";
import { Activity } from "lucide-react";
import { CrystalIcon, type CrystalName } from "@/components/marketplace/CrystalIcon";

interface ActivityTickerProps {
    apps: any[];
}

export function ActivityTicker({ apps }: ActivityTickerProps) {
    if (!apps || apps.length === 0) return null;

    // Only surface a real, honest event per app: it was published to the
    // marketplace. No cycled fake "installed / audited" verbs — those imply
    // events (installs, audits) that we haven't actually observed.
    const items = apps.slice(0, 12).map((app, i) => {
        const wallet = app.creatorWallet || "";
        return {
            key: `${app.id}-${i}`,
            crystal: "publish" as CrystalName,
            who: wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : "someone",
            text: `published ${app.name}`,
        };
    });

    return (
        <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm py-2 pl-3 pr-2 overflow-hidden">
            <div className="flex items-center gap-1.5 shrink-0 pr-3 border-r border-border/50">
                <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                <Activity size={11} className="text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Live</span>
            </div>
            <Marquee className="[--duration:50s] flex-1" pauseOnHover>
                {items.map(({ key, crystal, who, text }) => (
                    <div key={key} className="flex items-center gap-2 text-[11px] font-mono whitespace-nowrap">
                        <CrystalIcon name={crystal} size={18} alt="" />
                        <span className="text-muted-foreground uppercase tracking-wider">{who}</span>
                        <span className="text-foreground/80">{text}</span>
                        <span className="text-border">•</span>
                    </div>
                ))}
            </Marquee>
        </div>
    );
}
