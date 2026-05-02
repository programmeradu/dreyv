"use client";

import { RoomProvider } from "@/liveblocks.config";
import { LiveList, LiveMap } from "@liveblocks/client";
import { LiveCursors } from "@/components/LiveCursors";
import { CollaborativeHeader } from "@/components/CollaborativeHeader";
import { WalletButton } from "@/components/WalletButton";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSelf } from "@/liveblocks.config";
import { getAvatarUrl } from "@/lib/avatars";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { WalletCards, PieChart, Users, Settings, Database, LayoutGrid, ArchitectIcon } from "@/components/icons";
import { DreyvMark } from "@/components/brand/dreyv-mark";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CommandBar } from "@/components/CommandBar";
import { VaultStatusBar } from "@/components/VaultStatusBar";
import { useAppEvent } from "@/lib/events";
import { ThemeProvider, useTheme } from "@/lib/contexts/ThemeContext";
import { Sun, Moon, ShoppingBag, Library, LogOut, Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useKeystoneAuth } from "@/hooks/useKeystoneAuth";
import { authClient } from "@/lib/auth/client";
import { useWallet } from "@/lib/wallet/compat";
import { useProfile } from "@/lib/hooks/useProfile";
import { useVault } from "@/lib/contexts/VaultContext";
import { CanvasProvider } from "@/lib/canvas/CanvasContext";

function AppLayoutContent({ children }: { children: React.ReactNode }) {
    const { theme } = useTheme();
    const router = useRouter();
    const pathname = usePathname();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);

    // Close the mobile drawer on route change
    useEffect(() => {
        setMobileNavOpen(false);
    }, [pathname]);

    useAppEvent((event) => {
        if (event.type === "NAVIGATE" && event.payload) {
            router.push(event.payload);
        }
    });

    // Lazy sync Neon Auth user to DB on first load
    const syncedRef = useRef(false);
    useEffect(() => {
        if (syncedRef.current) return;
        syncedRef.current = true;
        fetch('/api/auth/sync', { method: 'POST' }).catch(() => {});
    }, []);

    const navItems = (
        <>
            <NavButton icon={LayoutGrid} label="Dashboard" href="/app" active={pathname === "/app"} />
            <NavButton icon={ArchitectIcon} label="Studio" href="/app/studio" active={pathname?.startsWith("/app/studio")} />
            <NavButton icon={ShoppingBag} label="Marketplace" href="/app/marketplace" active={pathname?.startsWith("/app/marketplace")} />
            <NavButton icon={Library} label="Library" href="/app/library" active={pathname?.startsWith("/app/library")} />
            <NavButton icon={WalletCards} label="Treasury" href="/app/treasury" active={pathname === "/app/treasury"} />
            <NavButton icon={PieChart} label="Analytics" href="/app/analytics" active={pathname === "/app/analytics"} />
            <NavButton icon={Users} label="Team" href="/app/team" active={pathname === "/app/team"} />
            <NavButton icon={Settings} label="Settings" href="/app/settings" active={pathname === "/app/settings"} />
        </>
    );

    return (
        <CanvasProvider>
        <div
            className="flex bg-background font-sans text-foreground h-dvh overflow-hidden selection:bg-primary/20 selection:text-primary dashboard-theme relative"
            data-theme={theme}
        >
            <Suspense fallback={null}>
                <LiveCursors />
            </Suspense>

            {/* Side Navigation — Desktop slim rail (hidden on mobile) */}
            <nav className="hidden md:flex flex-col items-center w-20 h-full py-3 border-r border-border bg-sidebar z-50 shrink-0 select-none">
                <Link href="/" className="mb-2 w-[46px] h-[46px] p-1.5 rounded-xl bg-violet-500/5 border border-violet-500/20 flex items-center justify-center shadow-[0_0_15px_rgba(139,92,246,0.12)] hover:scale-105 transition-transform group shrink-0 overflow-hidden">
                    <DreyvMark size={56} className="group-hover:drop-shadow-[0_0_10px_rgba(139,92,246,0.45)] transition-all shrink-0" />
                </Link>

                <TooltipProvider>
                    <div className="flex-1 flex flex-col items-center justify-center w-full px-3 gap-1.5 min-h-0">
                        <div className="flex flex-col gap-1.5 w-full items-center justify-center overflow-y-auto scrollbar-none">
                            {navItems}
                        </div>

                        <div className="my-1 border-t border-border opacity-50 w-8 shrink-0" />
                        <VaultStatusBar />
                    </div>
                </TooltipProvider>

                <div className="mt-2 mb-2 shrink-0">
                    <Suspense fallback={<div className="w-10 h-10 rounded-full bg-white/5 animate-pulse" />}>
                        <UserAccount />
                    </Suspense>
                </div>
            </nav>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 h-full relative md:overflow-hidden">
                {/* Mobile top bar — visible only below md */}
                <header className="md:hidden flex items-center justify-between gap-3 px-4 h-14 border-b border-border bg-sidebar/95 backdrop-blur z-40 shrink-0">
                    <Link href="/" className="flex items-center gap-2 min-w-0">
                        <span className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                            <DreyvMark size={32} />
                        </span>
                        <span className="font-semibold tracking-tight truncate">Dreyv</span>
                    </Link>
                    <div className="flex items-center gap-1 shrink-0">
                        <Suspense fallback={null}>
                            <UserAccount />
                        </Suspense>
                        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                            <SheetTrigger asChild>
                                <Button variant="ghost" size="icon" aria-label="Open navigation">
                                    <Menu className="w-5 h-5" />
                                </Button>
                            </SheetTrigger>
                            <SheetContent
                                side="left"
                                data-theme="light"
                                className="w-[78%] max-w-[300px] p-0 border-r border-violet-100 shadow-2xl !bg-white [&>button]:text-neutral-700 [&>button]:opacity-100"
                                style={{ backdropFilter: "none", WebkitBackdropFilter: "none", colorScheme: "light" }}
                            >
                                <SheetTitle className="sr-only">Navigation</SheetTitle>
                                <div className="flex flex-col h-full bg-white text-neutral-900">
                                    <div className="px-4 py-3 border-b border-violet-100 flex items-center gap-2.5">
                                        <span className="w-8 h-8 rounded-lg bg-violet-50 border border-violet-200 flex items-center justify-center shrink-0">
                                            <DreyvMark size={28} />
                                        </span>
                                        <div className="flex flex-col min-w-0 leading-tight">
                                            <span className="font-semibold tracking-tight text-[15px] text-neutral-900">Dreyv</span>
                                            <span className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">Command layer</span>
                                        </div>
                                    </div>
                                    <nav className="flex-1 min-h-0 overflow-hidden px-2 py-2 flex flex-col gap-0.5">
                                        <MobileNavRow icon={LayoutGrid} label="Dashboard" href="/app" active={pathname === "/app"} onNavigate={() => setMobileNavOpen(false)} />
                                        <MobileNavRow icon={ArchitectIcon} label="Studio" href="/app/studio" active={pathname?.startsWith("/app/studio")} onNavigate={() => setMobileNavOpen(false)} />
                                        <MobileNavRow icon={ShoppingBag} label="Marketplace" href="/app/marketplace" active={pathname?.startsWith("/app/marketplace")} onNavigate={() => setMobileNavOpen(false)} />
                                        <MobileNavRow icon={Library} label="Library" href="/app/library" active={pathname?.startsWith("/app/library")} onNavigate={() => setMobileNavOpen(false)} />
                                        <MobileNavRow icon={WalletCards} label="Treasury" href="/app/treasury" active={pathname === "/app/treasury"} onNavigate={() => setMobileNavOpen(false)} />
                                        <MobileNavRow icon={PieChart} label="Analytics" href="/app/analytics" active={pathname === "/app/analytics"} onNavigate={() => setMobileNavOpen(false)} />
                                        <MobileNavRow icon={Users} label="Team" href="/app/team" active={pathname === "/app/team"} onNavigate={() => setMobileNavOpen(false)} />
                                        <MobileNavRow icon={Settings} label="Settings" href="/app/settings" active={pathname === "/app/settings"} onNavigate={() => setMobileNavOpen(false)} />
                                    </nav>
                                    <div className="px-3 py-2.5 border-t border-violet-100 flex items-center justify-between gap-2 bg-white">
                                        <TooltipProvider>
                                            <VaultStatusBar />
                                            <ThemeToggle />
                                        </TooltipProvider>
                                    </div>
                                </div>
                            </SheetContent>
                        </Sheet>
                    </div>
                </header>

                {/* Ambient Bg Glow */}
                <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
                <div className="absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[120px] pointer-events-none" />

                <div className="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch] md:overflow-hidden">
                    <Suspense fallback={
                        <div className="flex-1 flex items-center justify-center">
                            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        </div>
                    }>
                        {children}
                    </Suspense>
                </div>

                {/* Floating Command Bar — single entry point. ⌘K is handled inside CommandBar. */}
                <CommandBar />
            </main>
        </div>
        </CanvasProvider>
    );
}

function useRoomId() {
    const [roomId, setRoomId] = useState<string | null>(null);
    const { user: siwsUser } = useKeystoneAuth();
    const { activeVault } = useVault();
    // Depend on the primitive id, NOT the user object — stops re-runs every render
    const siwsUserId = siwsUser?.id ?? null;

    useEffect(() => {
        // Tie Liveblocks presence directly to the active Multisig Vault
        if (activeVault) {
            const next = `vault:${activeVault}`;
            setRoomId((prev) => (prev === next ? prev : next));
            return;
        }

        if (siwsUserId) {
            const next = `user:${siwsUserId}`;
            setRoomId((prev) => (prev === next ? prev : next));
            return;
        }

        let cancelled = false;
        authClient.getSession().then((session) => {
            if (cancelled) return;
            const userId = session.data?.user?.id;
            if (userId && !activeVault) {
                const next = `user:${userId}`;
                setRoomId((prev) => (prev === next ? prev : next));
            }
        });
        return () => {
            cancelled = true;
        };
    }, [siwsUserId, activeVault]);

    return roomId;
}

export default function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <ThemeProvider>
            <AppLayoutWithRoom>{children}</AppLayoutWithRoom>
        </ThemeProvider>
    );
}

function AppLayoutWithRoom({ children }: { children: React.ReactNode }) {
    const roomId = useRoomId();

    if (!roomId) {
        return (
            <div className="flex items-center justify-center h-screen bg-background">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <RoomProvider
            id={roomId}
            initialPresence={{ cursor: null }}
            initialStorage={{
                teamNotes: "",
                chatMessages: new LiveList([]),
                proposalThreads: new LiveMap(),
            }}
        >
            <AppLayoutContent>{children}</AppLayoutContent>
        </RoomProvider>
    );
}

function NavButton({ icon: Icon, label, href, active }: { icon: any, label: string, href: string, active?: boolean }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Link
                    href={href}
                    className={`group flex flex-col items-center justify-center gap-1 w-11 h-11 rounded-xl transition-all duration-300 border border-transparent shrink-0
                  ${active
                            ? 'bg-primary/10 text-primary border-primary/20 shadow-[0_0_10px_var(--dashboard-accent-muted)]'
                            : 'bg-muted text-muted-foreground hover:bg-primary/20 hover:text-foreground'}`}
                >
                    <Icon strokeWidth={active ? 2.5 : 2} size={20} />
                </Link>
            </TooltipTrigger>
            <TooltipContent side="right">
                <p>{label}</p>
            </TooltipContent>
        </Tooltip>

    )
}

function MobileNavRow({ icon: Icon, label, href, active, onNavigate }: { icon: any, label: string, href: string, active?: boolean, onNavigate?: () => void }) {
    return (
        <Link
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors border
                ${active
                    ? 'bg-violet-50 text-violet-700 border-violet-200'
                    : 'bg-transparent text-neutral-700 border-transparent hover:bg-neutral-50 hover:text-neutral-900'}`}
        >
            <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${active ? 'bg-violet-100 text-violet-700' : 'bg-neutral-100 text-neutral-600'}`}>
                <Icon strokeWidth={active ? 2.4 : 2} size={15} />
            </span>
            <span className="truncate">{label}</span>
        </Link>
    )
}

function UserAccount() {
    const self = useSelf();
    const { signOut: siwsSignOut } = useKeystoneAuth();
    const { disconnect } = useWallet();
    const router = useRouter();
    const { profile } = useProfile();

    const handleLogout = async () => {
        try {
            await siwsSignOut();
        } catch {}
        try {
            await authClient.signOut();
        } catch {}
        try {
            await disconnect();
        } catch {}
        router.push("/auth");
    };

    const fallbackName = self?.info?.name || "User";

    // Read from DB-backed profile API (replaces localStorage)
    const displayName = profile?.displayName || fallbackName;
    const avatarSeed = profile?.avatarSeed || fallbackName;

    return (
        <HoverCard openDelay={0} closeDelay={200}>
            <HoverCardTrigger asChild>
                <div className="relative group cursor-pointer p-1">
                    <Avatar className="h-10 w-10 ring-2 ring-primary/10 ring-offset-2 ring-offset-background group-hover:ring-primary/40 transition-all bg-background">
                        <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(avatarSeed)}`} />
                        <AvatarFallback className="bg-primary/5 text-primary font-bold text-[10px]">
                            {displayName.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <div className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
                </div>
            </HoverCardTrigger>
            <HoverCardContent 
                side="right" 
                align="end" 
                sideOffset={14} 
                className="w-auto p-1.5 bg-background/95 backdrop-blur-xl border border-border/60 shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-xl relative overflow-hidden"
            >
                {/* Subtle gradient accent to match premium theme */}
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
                
                <button 
                    onClick={handleLogout}
                    className="flex items-center gap-3 px-4 py-2 text-[13px] font-semibold text-muted-foreground hover:text-red-500 hover:bg-destructive/10 rounded-lg transition-all duration-200 whitespace-nowrap group/btn w-full"
                >
                    <LogOut size={15} className="group-hover/btn:scale-110 transition-transform" />
                    <span className="tracking-wide">Sign Out</span>
                </button>
            </HoverCardContent>
        </HoverCard>
    );
}

function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    onClick={toggleTheme}
                    className="group flex flex-col items-center justify-center gap-1 w-11 h-11 rounded-xl transition-all duration-300 border border-transparent bg-muted text-muted-foreground hover:bg-primary/20 hover:text-foreground shrink-0"
                >
                    {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                </button>
            </TooltipTrigger>
            <TooltipContent side="right">
                <p>Switch to {theme === 'dark' ? 'Light' : 'Dark'} Mode</p>
            </TooltipContent>
        </Tooltip>
    );
}
