import React from "react";
import { Star, Zap, ShieldCheck, Download } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Link from "next/link";
import { getAvatarUrl } from "@/lib/avatars";
import { formatDistanceToNow } from "date-fns";

interface CompactAppProps {
    app: {
        id: string;
        name: string;
        description: string;
        priceUsdc: number | string;
        rating?: number;
        installs: number;
        creatorWallet: string;
        category: string;
        iconUrl?: string;
        securityScore?: number | null;
        updatedAt?: string | Date | null;
        version?: string;
    };
}

export function MiniAppCardCompact({ app }: CompactAppProps) {
    const price = Number(app.priceUsdc) || 0;
    const audited = (app.securityScore ?? 0) >= 80;
    const updated = app.updatedAt ? new Date(app.updatedAt) : null;

    return (
        <Link
            href={`/app/marketplace/${app.id}`}
            className="group relative flex flex-col p-4 rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm transition-all duration-200 hover:border-primary/40 hover:bg-card/70 hover:-translate-y-0.5"
        >
            <div className="flex items-start gap-3 mb-3">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-white/10 to-transparent border border-border/50 flex items-center justify-center shrink-0 overflow-hidden">
                    <Avatar className="h-full w-full rounded-xl">
                        <AvatarImage src={app.iconUrl || `https://api.dicebear.com/7.x/shapes/svg?seed=${app.id}`} />
                        <AvatarFallback><Zap size={18} className="text-primary" /></AvatarFallback>
                    </Avatar>
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <h3 className="text-sm font-bold tracking-tight truncate group-hover:text-primary transition-colors">
                            {app.name}
                        </h3>
                        {audited && (
                            <ShieldCheck size={12} className="text-primary shrink-0" aria-label="Audited" />
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                        <span className="truncate">{app.category}</span>
                        {updated && (
                            <>
                                <span>·</span>
                                <span className="truncate">{formatDistanceToNow(updated, { addSuffix: false })}</span>
                            </>
                        )}
                    </div>
                </div>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${price === 0
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                    : 'bg-primary/10 border border-primary/20 text-primary'
                    }`}>
                    {price === 0 ? 'FREE' : `${price} USDC`}
                </span>
            </div>

            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mb-3 min-h-[2rem]">
                {app.description}
            </p>

            <div className="mt-auto pt-2 border-t border-border/40 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                <div className="flex items-center gap-1.5">
                    <Avatar className="h-4 w-4">
                        <AvatarImage src={getAvatarUrl(app.creatorWallet)} />
                        <AvatarFallback>C</AvatarFallback>
                    </Avatar>
                    <span className="uppercase tracking-wider">
                        {app.creatorWallet.slice(0, 4)}…{app.creatorWallet.slice(-4)}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="flex items-center gap-0.5 text-orange-400">
                        <Star size={10} fill="currentColor" />
                        <span className="text-foreground font-bold ml-0.5">{app.rating?.toFixed(1) || "—"}</span>
                    </span>
                    <span className="flex items-center gap-0.5">
                        <Download size={10} />
                        <span>{app.installs.toLocaleString()}</span>
                    </span>
                </div>
            </div>
        </Link>
    );
}
