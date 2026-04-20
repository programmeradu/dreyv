"use client";
import React from "react";
import { Marquee } from "@/components/ui/marquee";
import { Activity, Download, Sparkles, ShieldCheck } from "lucide-react";

interface ActivityTickerProps {
    apps: any[];
}

export function ActivityTicker({ apps }: ActivityTickerProps) {
    if (!apps || apps.length === 0) return null;

    const items = apps.slice(0, 12).map((app, i) => {
        const variants = [
            { icon: Download, text: `installed ${app.name}`, accent: "text-primary" },
            { icon: Sparkles, text: `published ${app.name}`, accent: "text-emerald-400" },
            { icon: ShieldCheck, text: `audited ${app.name}`, accent: "text-blue-400" },
        ];
        const v = variants[i % variants.length];
        const wallet = app.creatorWallet || "";
        return {
            key: `${app.id}-${i}`,
            Icon: v.icon,
            accent: v.accent,
            who: `${wallet.slice(0, 4)}…${wallet.slice(-4)}`,
            text: v.text,
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
                {items.map(({ key, Icon, accent, who, text }) => (
                    <div key={key} className="flex items-center gap-2 text-[11px] font-mono whitespace-nowrap">
                        <Icon size={11} className={accent} />
                        <span className="text-muted-foreground uppercase tracking-wider">{who}</span>
                        <span className="text-foreground/80">{text}</span>
                        <span className="text-border">•</span>
                    </div>
                ))}
            </Marquee>
        </div>
    );
}
