"use client";

import React, { useEffect, useState } from "react";
import { getInstalledApps } from "@/actions/studio-actions";
import { useSelf } from "@/liveblocks.config";
import { useWallet } from "@/lib/wallet/compat";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Box, Play, Clock, MoreVertical, LayoutGrid, Store, Trash2, XCircle } from "lucide-react";
import { CrystalIcon } from "@/components/marketplace/CrystalIcon";
import { Logo } from "@/components/icons";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { ListingModal } from "@/components/studio/ListingModal";
import { toast } from "@/lib/toast-notifications";
import { notify } from "@/lib/notifications";

export default function LibraryPage() {
    const user = useSelf();
    const { publicKey } = useWallet();
    const [apps, setApps] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [listingApp, setListingApp] = useState<any>(null);

    const walletAddress = publicKey?.toBase58() || user?.info?.name || "";

    async function handleUninstall(app: any) {
        try {
            const { uninstallApp } = await import("@/actions/studio-actions");
            await uninstallApp(walletAddress, app.id);
            setApps(prev => prev.filter(a => a.id !== app.id));
            toast.success(`"${app.name}" uninstalled`, {
                description: "Removed from your Library.",
            });
        } catch (e) {
            toast.error("Failed to uninstall.");
        }
    }

    async function handleDelist(app: any) {
        try {
            await fetch("/api/studio/marketplace", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ appId: app.id, creatorWallet: walletAddress, isPublished: false }),
            });
            setApps(prev => prev.map(a => a.id === app.id ? { ...a, isPublished: false } : a));
            toast.success(`"${app.name}" delisted`, {
                description: "Removed from the Marketplace.",
            });
            notify.delist(app.name);
        } catch (e) {
            toast.error("Failed to delist.");
        }
    }

    useEffect(() => {
        loadApps();
    }, [user, publicKey]);

    async function loadApps() {
        try {
            const data = await getInstalledApps(walletAddress);
            setApps(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="h-screen flex flex-col bg-white text-slate-900 overflow-hidden relative font-[Manrope,sans-serif] selection:bg-violet-200">
            {/* Ambient violet glow */}
            <div className="pointer-events-none absolute -top-40 right-0 w-[500px] h-[500px] bg-violet-300/25 rounded-full blur-3xl" />

            {/* Header */}
            <header className="h-16 border-b border-violet-100 flex items-center justify-between px-8 bg-white shrink-0 z-10">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center border border-violet-200 text-violet-700">
                        <LayoutGrid size={20} strokeWidth={2.5} />
                    </div>
                    <div>
                        <h1 className="text-lg font-black tracking-tight uppercase text-slate-900">App Library</h1>
                        <p className="text-[10px] text-slate-500 font-bold tracking-[0.2em] uppercase">
                            Your Installed & Created Software
                        </p>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto p-8 scrollbar-thin z-0 relative">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-[50vh] text-slate-500 animate-pulse gap-4">
                        <Loader2 className="animate-spin w-8 h-8 text-violet-500" />
                        <span className="text-xs uppercase tracking-widest font-medium">Syncing Library...</span>
                    </div>
                ) : apps.length === 0 ? (
                    <div className="max-w-5xl mx-auto mt-4 space-y-8">
                        {/* Hero card */}
                        <div className="relative overflow-hidden rounded-3xl border border-violet-100 bg-white p-12">
                            <div className="relative z-10 grid md:grid-cols-[1fr_auto] gap-10 items-center">
                                <div className="space-y-5 max-w-xl">
                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-[10px] font-bold uppercase tracking-[0.18em]">
                                        <span className="w-1.5 h-1.5 rounded-full bg-violet-600" />
                                        Your library is ready
                                    </div>
                                    <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900 leading-[1.05]">
                                        Build the workspace<br />
                                        <span className="text-violet-700">that works for you.</span>
                                    </h2>
                                    <p className="text-base text-slate-600 leading-relaxed">
                                        Install ready-made apps from the Marketplace, or build your own in Studio.
                                        Everything you collect lives here — one click away.
                                    </p>
                                    <div className="flex flex-wrap gap-3 pt-2">
                                        <Link href="/app/studio">
                                            <Button className="h-11 px-6 text-sm font-semibold rounded-xl bg-violet-600 text-white hover:bg-violet-700">
                                                Create your first app
                                            </Button>
                                        </Link>
                                        <Link href="/app/marketplace">
                                            <Button variant="outline" className="h-11 px-6 text-sm font-semibold rounded-xl border-violet-200 text-violet-700 hover:bg-violet-50">
                                                Browse Marketplace
                                            </Button>
                                        </Link>
                                    </div>
                                </div>

                                <div className="hidden md:flex relative w-48 h-48 items-center justify-center">
                                    <CrystalIcon name="all" size={180} alt="Your Library" />
                                </div>
                            </div>
                        </div>

                        {/* Quick paths */}
                        <div className="grid md:grid-cols-3 gap-4">
                            {[
                                { icon: Store, title: "Browse Marketplace", desc: "Discover apps built by the community.", href: "/app/marketplace", cta: "Explore" },
                                { icon: Box, title: "Open Studio", desc: "Build, test and ship your own apps.", href: "/app/studio", cta: "Start building" },
                                { icon: Play, title: "View samples", desc: "Try template apps to see what's possible.", href: "/app/marketplace?filter=templates", cta: "See templates" },
                            ].map((item) => (
                                <Link key={item.title} href={item.href} className="group">
                                    <div className="h-full rounded-2xl border border-violet-100 bg-white p-5 hover:border-violet-300 transition-colors">
                                        <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center text-violet-700 mb-4 group-hover:bg-violet-100 transition-colors">
                                            <item.icon size={18} />
                                        </div>
                                        <h4 className="text-sm font-semibold text-slate-900 mb-1">{item.title}</h4>
                                        <p className="text-xs text-slate-500 leading-relaxed mb-3">{item.desc}</p>
                                        <span className="text-xs font-semibold text-violet-700 group-hover:underline">
                                            {item.cta} →
                                        </span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {apps.map((app) => (
                            <Card key={app.id} className="group bg-white border-violet-100 hover:border-violet-300 transition-colors overflow-hidden">
                                <CardHeader className="p-0">
                                    <div className="h-32 bg-violet-50 relative overflow-hidden group-hover:bg-violet-100 transition-colors">
                                        {app.iconUrl ? (
                                            <img src={app.iconUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-60 transition-opacity" />
                                        ) : null}
                                        <div className="absolute top-4 right-4">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-slate-900">
                                                        <MoreVertical size={14} />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem>
                                                        <Link href={`/app/studio?appId=${app.id}`} className="w-full">
                                                            Edit Source
                                                        </Link>
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        onClick={() => setListingApp(app)}
                                                        className="text-violet-700"
                                                    >
                                                        <Store size={12} className="mr-2" />
                                                        {app.isPublished ? "Update Listing" : "List on Marketplace"}
                                                    </DropdownMenuItem>
                                                    {app.isPublished && (
                                                        <>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem
                                                                onClick={() => handleDelist(app)}
                                                                className="text-amber-600"
                                                            >
                                                                <XCircle size={12} className="mr-2" />
                                                                Delist from Marketplace
                                                            </DropdownMenuItem>
                                                        </>
                                                    )}
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        onClick={() => handleUninstall(app)}
                                                        className="text-rose-600"
                                                    >
                                                        <Trash2 size={12} className="mr-2" />
                                                        Uninstall
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                        <div className="absolute bottom-4 left-4">
                                            <div className="w-10 h-10 rounded bg-white border border-violet-200 flex items-center justify-center text-violet-700 overflow-hidden">
                                                {app.iconUrl ? (
                                                    <img src={app.iconUrl} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <Box size={20} />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-5">
                                    <div className="flex justify-between items-start mb-2">
                                        <h3 className="font-bold text-base text-slate-900 truncate pr-2">
                                            {app.name}
                                        </h3>
                                        <Badge variant="secondary" className="text-[9px] h-4 bg-violet-50 text-violet-700 border-violet-200">
                                            {app.version}
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-slate-500 line-clamp-2 h-8 mb-4">
                                        {app.description}
                                    </p>

                                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                                        <span className="flex items-center gap-1">
                                            <Clock size={10} />
                                            {formatDistanceToNow(new Date(app.updatedAt), { addSuffix: true })}
                                        </span>
                                        <span className="uppercase tracking-wider">
                                            {app.isPublished ? "Public" : "Draft"}
                                        </span>
                                    </div>
                                </CardContent>
                                <CardFooter className="p-4 pt-0">
                                    <Link href={`/app/run/${app.id}`} className="w-full">
                                        <Button className="w-full gap-2 text-xs font-bold uppercase tracking-widest bg-violet-600 text-white hover:bg-violet-700">
                                            <Play size={12} fill="currentColor" />
                                            Launch App
                                        </Button>
                                    </Link>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
            {listingApp && (
                <ListingModal
                    open={!!listingApp}
                    onOpenChange={(open) => { if (!open) setListingApp(null); }}
                    app={listingApp}
                    onSuccess={() => {
                        setListingApp(null);
                        loadApps();
                    }}
                />
            )}
        </div>
    );
}
