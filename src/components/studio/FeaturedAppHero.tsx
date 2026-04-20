"use client";
import React, { useEffect, useState } from "react";
import { Sparkles, Download, ShieldCheck, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarUrl } from "@/lib/avatars";
import Link from "next/link";

interface FeaturedAppHeroProps {
    apps: any[];
}

export function FeaturedAppHero({ apps }: FeaturedAppHeroProps) {
    const [idx, setIdx] = useState(0);
    const featured = apps.slice(0, 5);

    useEffect(() => {
        if (featured.length <= 1) return;
        const t = setInterval(() => setIdx(i => (i + 1) % featured.length), 6500);
        return () => clearInterval(t);
    }, [featured.length]);

    if (featured.length === 0) return null;
    const app = featured[idx];
    const price = Number(app.priceUsdc) || 0;
    const audited = (app.securityScore ?? 0) >= 80;

    return (
        <div className="relative rounded-2xl border border-border/60 bg-card/40 backdrop-blur-md overflow-hidden isolate">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.18),transparent_60%)] pointer-events-none" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,hsl(var(--primary)/0.08),transparent_55%)] pointer-events-none" />

            <div className="relative grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-6 p-5 md:p-7 items-center">
                {/* Left: Meta */}
                <div className="flex flex-col gap-3 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary/15 border border-primary/30 text-[10px] font-black uppercase tracking-[0.18em] text-primary">
                            <Sparkles size={10} /> Featured
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                            App of the moment · {idx + 1}/{featured.length}
                        </span>
                    </div>

                    <div>
                        <h2 className="text-2xl md:text-3xl font-black tracking-tighter leading-tight mb-1.5 truncate">
                            {app.name}
                        </h2>
                        <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed max-w-prose">
                            {app.description}
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/40 border border-border/50">
                            <Avatar className="h-4 w-4">
                                <AvatarImage src={getAvatarUrl(app.creatorWallet)} />
                                <AvatarFallback>C</AvatarFallback>
                            </Avatar>
                            <span className="uppercase tracking-wider text-muted-foreground">
                                {app.creatorWallet.slice(0, 4)}…{app.creatorWallet.slice(-4)}
                            </span>
                        </div>
                        <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-background/40 border border-border/50 text-muted-foreground">
                            <Download size={11} /> <span className="text-foreground font-bold">{(app.installs || 0).toLocaleString()}</span> installs
                        </span>
                        {audited && (
                            <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 border border-primary/25 text-primary">
                                <ShieldCheck size={11} /> Audited
                            </span>
                        )}
                        <span className={`px-2 py-1 rounded-md font-black uppercase tracking-wider ${price === 0
                            ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400'
                            : 'bg-primary/10 border border-primary/25 text-primary'
                            }`}>
                            {price === 0 ? 'FREE' : `${price} USDC`}
                        </span>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                        <Link href={`/app/marketplace/${app.id}`}>
                            <Button size="sm" className="h-9 px-4 text-xs font-black uppercase tracking-widest bg-primary text-black hover:bg-primary/90">
                                Install <ArrowRight size={14} className="ml-1" />
                            </Button>
                        </Link>
                        <div className="flex items-center gap-1 ml-auto md:ml-0">
                            <button
                                onClick={() => setIdx(i => (i - 1 + featured.length) % featured.length)}
                                className="h-8 w-8 rounded-md border border-border/50 hover:border-primary/40 hover:bg-card/60 flex items-center justify-center transition-colors"
                                aria-label="Previous featured app"
                            >
                                <ChevronLeft size={14} />
                            </button>
                            <button
                                onClick={() => setIdx(i => (i + 1) % featured.length)}
                                className="h-8 w-8 rounded-md border border-border/50 hover:border-primary/40 hover:bg-card/60 flex items-center justify-center transition-colors"
                                aria-label="Next featured app"
                            >
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right: Screenshot */}
                <Link
                    href={`/app/marketplace/${app.id}`}
                    className="relative aspect-[16/10] rounded-xl border border-border/60 bg-background/40 overflow-hidden group block"
                >
                    {app.screenshotUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={app.screenshotUrl}
                            alt={app.name}
                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                        />
                    ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-background flex items-center justify-center">
                            <Avatar className="h-24 w-24 rounded-2xl">
                                <AvatarImage src={app.iconUrl || `https://api.dicebear.com/7.x/shapes/svg?seed=${app.id}`} />
                                <AvatarFallback><Sparkles className="text-primary" /></AvatarFallback>
                            </Avatar>
                        </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/80 to-transparent" />
                </Link>
            </div>

            {/* Pagination dots */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5">
                {featured.map((_, i) => (
                    <button
                        key={i}
                        onClick={() => setIdx(i)}
                        className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50'}`}
                        aria-label={`Featured ${i + 1}`}
                    />
                ))}
            </div>
        </div>
    );
}
