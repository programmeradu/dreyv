"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Urbanist } from "next/font/google";
import { Menu, LayoutDashboard, Shield, Radar, Compass, History, FlaskConical, Settings, ChevronDown } from "lucide-react";
import { IconMarketPulse } from "@/components/ui/icons";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { toast } from "@/lib/toast-notifications";
import { AtlasHeaderTicker } from "@/components/atlas/AtlasHeaderTicker";

const wordmark = Urbanist({ subsets: ["latin"], weight: "600", display: "swap", adjustFontFallback: true });

const navIcons: Record<string, React.ReactNode> = {
  overview: <LayoutDashboard className="h-[18px] w-[18px]" />,
  "market-pulse-card": <IconMarketPulse className="h-[18px] w-[18px]" />,
  "token-intel-section": <Shield className="h-[18px] w-[18px]" />,
  "mev-scanner-card": <Radar className="h-[18px] w-[18px]" />,
  "yield-section": <Compass className="h-[18px] w-[18px]" />,
  "time-machine-section": <History className="h-[18px] w-[18px]" />,
  "strategy-lab": <FlaskConical className="h-[18px] w-[18px]" />,
};

const navGroups = [
  { label: "COMMAND CENTER", items: [
    { id: "overview", label: "Overview", href: "/atlas" },
    { id: "market-pulse-card", label: "Market Pulse", href: "/atlas#market-pulse-card" },
    { id: "token-intel-section", label: "Token Intel", href: "/atlas#token-intel-section" },
    { id: "mev-scanner-card", label: "MEV Detector", href: "/atlas#mev-scanner-card" },
  ]},
  { label: "EXPLORE", items: [
    { id: "yield-section", label: "Opportunities", href: "/atlas#yield-section" },
    { id: "time-machine-section", label: "Time Machine", href: "/atlas#time-machine-section" },
    { id: "strategy-lab", label: "Strategy Lab", href: "/atlas/strategy-lab" },
  ]},
];

export function AtlasShell({ children, activeSection }: { children: React.ReactNode, activeSection: string }) {
  const router = useRouter();
  const { publicKey, wallet, disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleNavClick = (href: string) => {
    setSidebarOpen(false);
    if (href.startsWith("/atlas#")) {
      const id = href.split("#")[1];
      if (window.location.pathname === "/atlas") {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
      } else {
        router.push(href);
      }
    } else {
      router.push(href);
    }
  };

  return (
    <div className="h-full flex overflow-hidden transition-colors duration-300">
      {sidebarOpen && <div className="fixed inset-0 bg-black/20 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* ── Sidebar ────────────────────────────────────────── */}
      <aside className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 fixed md:relative z-40 w-64 flex-shrink-0 border-r border-slate-200 atlas-sidebar flex flex-col justify-between h-full transition-transform duration-200`}>
        <div>
          <div className="h-16 flex items-center px-6 border-b border-slate-200">
            <Link href="/" className="flex items-center gap-2 group rounded-lg">
              <span className={`${wordmark.className} text-xl font-semibold tracking-tight text-violet-700 lowercase leading-none group-hover:text-violet-600 transition-colors antialiased`}>dreyv</span>
              <span className="text-xs text-slate-400 font-medium">atlas</span>
            </Link>
          </div>
          <nav className="p-4 space-y-1">
            {navGroups.map((g) => (
              <div key={g.label}>
                <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 mt-4">{g.label}</p>
                {g.items.map((item) => (
                  <button key={item.id} onClick={() => handleNavClick(item.href)}
                    className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${activeSection === item.id ? "bg-violet-100 text-violet-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
                    <span className="mr-3">{navIcons[item.id]}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </div>
        <div className="p-4 border-t border-slate-200">
          {publicKey ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg text-slate-600 hover:bg-slate-100 transition-colors">
                  <div className="flex items-center">
                    {wallet?.adapter?.icon ? (
                      <img src={wallet.adapter.icon} alt={wallet.adapter.name} className="w-6 h-6 rounded-full mr-2 bg-white object-cover shadow-sm" />
                    ) : (
                      <img
                        src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(publicKey.toBase58())}`}
                        alt="Wallet avatar"
                        className="w-6 h-6 rounded-full mr-2 bg-white object-cover shadow-sm ring-1 ring-violet-200"
                      />
                    )}
                    <span className="font-mono text-xs">{publicKey.toBase58().slice(0, 4)}…{publicKey.toBase58().slice(-4)}</span>
                  </div>
                  <ChevronDown className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={async () => { await navigator.clipboard.writeText(publicKey.toBase58()); toast.success("Address copied"); }}>Copy address</DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(`https://solscan.io/address/${publicKey.toBase58()}`, "_blank", "noopener,noreferrer")}>View on Solscan</DropdownMenuItem>
                <DropdownMenuItem onClick={() => disconnect?.()}>Disconnect</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button onClick={() => setVisible(true)} className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg text-slate-600 hover:bg-slate-100 transition-colors">
              <div className="flex items-center">
                <span>Select Wallet</span>
              </div>
              <ChevronDown className="h-4 w-4" />
            </button>
          )}
          <div className="mt-2 flex justify-around">
            <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors rounded-lg hover:bg-slate-100">
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ───────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative z-10">
        <header className="h-16 flex-shrink-0 flex items-center gap-3 px-4 sm:px-6 lg:px-8 border-b border-slate-200/50 atlas-header z-20">
          <button className="md:hidden text-slate-500 hover:text-slate-700" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <Menu className="h-6 w-6" />
          </button>
          <AtlasHeaderTicker />
        </header>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 space-y-6">
          {children}
        </div>
      </main>
    </div>
  );
}
