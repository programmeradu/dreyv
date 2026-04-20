"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { WalletButton } from "@/components/WalletButton";
import { CollaborativeHeader } from "@/components/CollaborativeHeader";
import { Search, Plus, Box, ArrowRight, Rocket, Flame, Sparkles, Star, Gift, TrendingUp } from "lucide-react";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import { Suspense } from "react";
import { MiniAppCardCompact } from "@/components/studio/MiniAppCardCompact";
import { FeaturedAppHero } from "@/components/studio/FeaturedAppHero";
import { ActivityTicker } from "@/components/studio/ActivityTicker";
import { BuilderSpotlight } from "@/components/studio/BuilderSpotlight";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PremiumModal, PremiumModalHeader, PremiumModalTitle, PremiumModalDescription } from "@/components/ui/PremiumModal";
import { ListingModal } from "@/components/studio/ListingModal";
import { NotificationBell } from "@/components/NotificationBell";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";

const CATEGORIES = [
    { key: "All", icon: Sparkles },
    { key: "DeFi", icon: TrendingUp },
    { key: "NFT", icon: Star },
    { key: "Governance", icon: Box },
    { key: "Analytics", icon: TrendingUp },
    { key: "Utility", icon: Box },
    { key: "Trading", icon: Flame },
    { key: "Security", icon: Box },
    { key: "Social", icon: Box },
];

interface Section {
    key: string;
    title: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    accent: string;
    filter: (apps: any[]) => any[];
}

export default function MarketplacePage() {
    const [search, setSearch] = useState("");
    const [allApps, setAllApps] = useState<any[]>([]);
    const [showPublishPicker, setShowPublishPicker] = useState(false);
    const [libraryApps, setLibraryApps] = useState<any[]>([]);
    const [listingApp, setListingApp] = useState<any>(null);
    const [categoryFilter, setCategoryFilter] = useState("All");
    const [loadingApps, setLoadingApps] = useState(true);
    const [nowTs, setNowTs] = useState<number | null>(null);

    const { network, setNetwork } = useNetwork();
    const { publicKey } = useWallet();

    const loadMarketplaceListings = useCallback(async () => {
        setLoadingApps(true);
        try {
            const res = await fetch("/api/studio/marketplace");
            const dbApps = res.ok ? await res.json() : [];
            setAllApps(Array.isArray(dbApps) ? dbApps : []);
        } catch {
            setAllApps([]);
        } finally {
            setLoadingApps(false);
        }
    }, []);

    useEffect(() => {
        loadMarketplaceListings();
    }, [loadMarketplaceListings]);

    useEffect(() => {
        setNowTs(Date.now());
    }, []);

    useEffect(() => {
        if (showPublishPicker) {
            (async () => {
                try {
                    const { getInstalledApps } = await import("@/actions/studio-actions");
                    const walletAddress = publicKey?.toBase58() || "";
                    const apps = await getInstalledApps(walletAddress);
                    setLibraryApps(apps);
                } catch {
                    setLibraryApps([]);
                }
            })();
        }
    }, [showPublishPicker, publicKey]);

    const filtered = useMemo(() => {
        const lower = search.toLowerCase();
        return allApps.filter(app => {
            const matchesSearch = !lower ||
                app.name?.toLowerCase().includes(lower) ||
                app.description?.toLowerCase().includes(lower);
            const matchesCategory = categoryFilter === "All" ||
                app.category?.toLowerCase() === categoryFilter.toLowerCase();
            return matchesSearch && matchesCategory;
        });
    }, [search, allApps, categoryFilter]);

    const isFiltering = search.length > 0 || categoryFilter !== "All";

    const sections: Section[] = useMemo(() => {
        const WEEK = 7 * 24 * 60 * 60 * 1000;
        const currentNow = nowTs;
        return [
            {
                key: "trending",
                title: "Trending",
                icon: Flame,
                accent: "text-orange-400",
                filter: (a) => [...a].sort((x, y) => (y.installs || 0) - (x.installs || 0)).slice(0, 8),
            },
            {
                key: "new",
                title: "New this week",
                icon: Sparkles,
                accent: "text-primary",
                filter: (a) => {
                    const sorted = [...a].sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());
                    if (!currentNow) return sorted.slice(0, 8);
                    return sorted
                        .filter(x => x.createdAt && (currentNow - new Date(x.createdAt).getTime()) < WEEK)
                        .slice(0, 8);
                },
            },
            {
                key: "staff",
                title: "Staff picks",
                icon: Star,
                accent: "text-yellow-400",
                filter: (a) => [...a]
                    .filter(x => (x.securityScore ?? 0) >= 80 || (x.rating ?? 0) >= 4.5)
                    .slice(0, 8),
            },
            {
                key: "free",
                title: "Free",
                icon: Gift,
                accent: "text-emerald-400",
                filter: (a) => a.filter(x => Number(x.priceUsdc) === 0).slice(0, 8),
            },
            {
                key: "most",
                title: "Most installed",
                icon: TrendingUp,
                accent: "text-blue-400",
                filter: (a) => [...a].sort((x, y) => (y.installs || 0) - (x.installs || 0)).slice(0, 8),
            },
        ];
    }, [nowTs]);

    return (
        <div className="flex-1 flex flex-col h-screen bg-background overflow-hidden relative">
            <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-background/70 backdrop-blur-md z-20 shrink-0">
                <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--dashboard-accent)]" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-70">dreyv OS // App Layer</span>
                    </div>
                    <h1 className="text-base font-bold tracking-tight text-foreground uppercase">Marketplace</h1>
                </div>

                <div className="flex items-center gap-3">
                    <NotificationBell />
                    <button
                        onClick={() => setNetwork(network === 'mainnet-beta' ? 'devnet' : 'mainnet-beta')}
                        className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors ${network === 'mainnet-beta' ? 'bg-primary/10 border-primary/20 hover:bg-primary/20' : 'bg-orange-500/10 border-orange-500/20 hover:bg-orange-500/20'}`}
                    >
                        <div className={`w-1.5 h-1.5 rounded-full shadow-[0_0_8px_currentColor] ${network === 'mainnet-beta' ? 'bg-primary' : 'bg-orange-500'}`} />
                        <span className="text-xs font-medium text-foreground uppercase">{network === 'mainnet-beta' ? 'Mainnet' : 'Devnet'}</span>
                    </button>
                    <Suspense fallback={<div className="h-8 w-24 bg-muted animate-pulse rounded-full" />}>
                        <CollaborativeHeader />
                    </Suspense>
                    <div className="w-px h-6 bg-border mx-1" />
                    <WalletButton />
                </div>
            </header>

            <div className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur-lg shrink-0">
                <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center gap-3">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                        <Input
                            placeholder="Search apps, builders, strategies…"
                            className="h-9 pl-9 bg-card/40 border-border/60 text-sm focus-visible:ring-1 focus-visible:ring-primary/40"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <div className="flex-1 overflow-x-auto scrollbar-none">
                        <div className="flex items-center gap-1.5">
                            {CATEGORIES.map(({ key, icon: Icon }) => {
                                const active = categoryFilter === key;
                                return (
                                    <button
                                        key={key}
                                        onClick={() => setCategoryFilter(key)}
                                        className={`shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11px] font-bold uppercase tracking-wider border transition-all ${active
                                            ? 'bg-primary/15 border-primary/40 text-primary'
                                            : 'bg-card/30 border-border/50 text-muted-foreground hover:border-border hover:text-foreground'
                                            }`}
                                    >
                                        <Icon size={11} />
                                        {key}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <Button
                        size="sm"
                        onClick={() => setShowPublishPicker(true)}
                        className="h-9 px-3 text-[11px] font-black uppercase tracking-widest bg-primary text-black hover:bg-primary/90 shrink-0"
                    >
                        <Plus size={14} className="mr-1" /> Publish
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin">
                <div className="max-w-[1600px] mx-auto px-6 py-5 space-y-6">
                    {!loadingApps && allApps.length > 0 && <ActivityTicker apps={allApps} />}

                    {!isFiltering && !loadingApps && allApps.length > 0 && (
                        <FeaturedAppHero apps={allApps} />
                    )}

                    {loadingApps && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <div key={i} className="bg-card/40 border border-border/50 rounded-xl p-4 animate-pulse h-[160px]">
                                    <div className="h-3 bg-muted rounded w-2/3 mb-2" />
                                    <div className="h-2 bg-muted rounded w-full mb-2" />
                                    <div className="h-2 bg-muted rounded w-1/2" />
                                </div>
                            ))}
                        </div>
                    )}

                    {!loadingApps && isFiltering && (
                        <section className="space-y-3">
                            <div className="flex items-baseline justify-between">
                                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-foreground">
                                    Results <span className="text-muted-foreground font-mono ml-1">({filtered.length})</span>
                                </h3>
                                <button
                                    onClick={() => { setSearch(""); setCategoryFilter("All"); }}
                                    className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors"
                                >
                                    Clear
                                </button>
                            </div>
                            {filtered.length === 0 ? (
                                <div className="text-center py-20 rounded-xl border border-dashed border-border/60">
                                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-3">
                                        <Search className="w-5 h-5 text-muted-foreground" />
                                    </div>
                                    <p className="text-sm font-bold mb-1">No apps found</p>
                                    <p className="text-xs text-muted-foreground">Try a different search or category.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                    {filtered.map(app => (
                                        <MiniAppCardCompact key={app.id} app={app} />
                                    ))}
                                </div>
                            )}
                        </section>
                    )}

                    {!loadingApps && !isFiltering && allApps.length > 0 && (
                        <>
                            <BuilderSpotlight apps={allApps} />
                            {sections.map(section => {
                                const items = section.filter(allApps);
                                if (items.length === 0) return null;
                                const Icon = section.icon;
                                return (
                                    <section key={section.key} className="space-y-3">
                                        <div className="flex items-baseline justify-between">
                                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-foreground flex items-center gap-2">
                                                <Icon size={12} className={section.accent} />
                                                {section.title}
                                                <span className="text-muted-foreground font-mono ml-1 normal-case tracking-normal">
                                                    {items.length}
                                                </span>
                                            </h3>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                            {items.map(app => (
                                                <MiniAppCardCompact key={`${section.key}-${app.id}`} app={app} />
                                            ))}
                                        </div>
                                    </section>
                                );
                            })}
                        </>
                    )}

                    {!loadingApps && allApps.length === 0 && (
                        <div className="text-center py-32 rounded-2xl border border-dashed border-border/60">
                            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-3">
                                <Rocket className="w-6 h-6 text-muted-foreground" />
                            </div>
                            <h3 className="text-base font-bold mb-1">No apps published yet</h3>
                            <p className="text-xs text-muted-foreground mb-4">Be the first to ship a mini-app to the marketplace.</p>
                            <Button
                                onClick={() => setShowPublishPicker(true)}
                                className="h-9 px-4 text-xs font-black uppercase tracking-widest bg-primary text-black hover:bg-primary/90"
                            >
                                <Plus size={14} className="mr-1" /> Publish App
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            <PremiumModal isOpen={showPublishPicker} onClose={() => setShowPublishPicker(false)} className="sm:max-w-[500px]">
                <PremiumModalHeader>
                    <PremiumModalTitle className="flex items-center gap-2">
                        <Rocket size={18} className="text-primary" />
                        Publish to Marketplace
                    </PremiumModalTitle>
                    <PremiumModalDescription>
                        Select an app from your Library to list on the Marketplace.
                    </PremiumModalDescription>
                </PremiumModalHeader>

                {libraryApps.length === 0 ? (
                    <div className="py-8 flex flex-col items-center gap-4 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground">
                            <Box size={28} />
                        </div>
                        <div>
                            <p className="font-bold mb-1">No apps in your Library</p>
                            <p className="text-sm text-muted-foreground">Build an app in the Studio and SHIP it first.</p>
                        </div>
                        <Link href="/app/studio">
                            <Button className="gap-2">
                                Open Studio <ArrowRight size={14} />
                            </Button>
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-2 max-h-[400px] overflow-y-auto py-2">
                        {libraryApps.map((app: any) => {
                            const alreadyListed = app.isPublished;
                            return (
                                <button
                                    key={app.id}
                                    onClick={() => {
                                        setShowPublishPicker(false);
                                        setListingApp(app);
                                    }}
                                    className="w-full flex items-center gap-4 p-4 rounded-xl border border-border/40 hover:border-primary/40 hover:bg-primary/5 transition-all text-left group"
                                >
                                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground group-hover:text-primary shrink-0">
                                        <Box size={20} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-sm truncate group-hover:text-primary transition-colors">{app.name}</p>
                                        <p className="text-xs text-muted-foreground truncate">{app.description || "No description"}</p>
                                    </div>
                                    <div className="shrink-0">
                                        {alreadyListed ? (
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-1 rounded-md">Update</span>
                                        ) : (
                                            <ArrowRight size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </PremiumModal>

            {listingApp && (
                <ListingModal
                    open={!!listingApp}
                    onOpenChange={(open) => { if (!open) setListingApp(null); }}
                    app={listingApp}
                    onSuccess={() => {
                        setListingApp(null);
                        loadMarketplaceListings();
                    }}
                />
            )}
        </div>
    );
}
