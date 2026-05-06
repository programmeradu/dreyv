"use client";

/**
 * Plan & Usage — Stitch-light Dreyv aesthetic.
 *
 * Restyled billing/usage panel: white shells, violet glows, DreyvStar marks,
 * real tier names (Base / Mini / Max), live revenue+spend stats, transaction
 * history. All data wiring preserved.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  BarChart3,
  Package,
  Bell,
  Store,
  ShoppingCart,
  ArrowRight,
  RefreshCw,
  ArrowUpRight,
  Loader2,
} from "lucide-react";
import { useNotificationStore } from "@/lib/notifications";
import { formatDistanceToNow } from "date-fns";
import { useWallet } from "@/lib/wallet/compat";
import { toast } from "@/lib/toast-notifications";
import { billingStatusPath } from "@/lib/billing-endpoints";
import { DreyvStar } from "@/components/studio/DreyvStar";

interface AppStats {
  appsCreated: number;
  appsListed: number;
  appsPurchased: number;
  totalSpentSol: number;
  totalEarnedSol: number;
}

const TIER_META: Record<string, { label: string; price: string; features: string[]; cta: string | null }> = {
  free: {
    label: "Base",
    price: "$0 / mo",
    features: [
      "Up to 5 agent personas",
      "Marketplace publishing",
      "On-chain payments (Solana)",
      "Persistent notification history",
    ],
    cta: "Upgrade to Mini",
  },
  mini: {
    label: "Mini",
    price: "$49 / mo",
    features: [
      "Up to 25 agent personas",
      "Priority MCP throughput",
      "Squads multisig escalation",
      "Webhook + Telegram + Slack",
    ],
    cta: "Upgrade to Max",
  },
  max: {
    label: "Max",
    price: "$199 / mo",
    features: [
      "Unlimited agent personas",
      "Dedicated specialist fabric",
      "Premium support SLA",
      "Early access to new capabilities",
    ],
    cta: null,
  },
};

async function loadStatsFromDb(wallet: string): Promise<AppStats> {
  try {
    const { getProjects, getInstalledApps } = await import("@/actions/studio-actions");
    const projects = await getProjects(wallet);
    const installed = await getInstalledApps(wallet);
    const listed = projects.filter((p: any) => p.isPublished);
    const purchased = installed.filter((a: any) => a.creatorWallet !== wallet);
    const totalEarned = listed.reduce((s: number, a: any) => s + ((a.installs || 0) * parseFloat(a.priceUsdc || "0") * 0.8), 0);
    const totalSpent = purchased.reduce((s: number, a: any) => s + parseFloat(a.priceUsdc || "0"), 0);
    return {
      appsCreated: projects.length,
      appsListed: listed.length,
      appsPurchased: purchased.length,
      totalSpentSol: totalSpent,
      totalEarnedSol: totalEarned,
    };
  } catch {
    return { appsCreated: 0, appsListed: 0, appsPurchased: 0, totalSpentSol: 0, totalEarnedSol: 0 };
  }
}

export const BillingView = () => {
  const [stats, setStats] = useState<AppStats>({ appsCreated: 0, appsListed: 0, appsPurchased: 0, totalSpentSol: 0, totalEarnedSol: 0 });
  const [tier, setTier] = useState<string>("free");
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  const { notifications } = useNotificationStore();
  const { publicKey } = useWallet();

  const fetchStatus = async () => {
    try {
      const res = await fetch(billingStatusPath());
      const data = await res.json();
      if (data.tier) setTier(data.tier);
      if (data.status) setStatus(data.status);
    } catch {
      console.error("Failed to fetch billing status");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await fetch(billingStatusPath());
      const data = await res.json();
      if (data.reconciled) {
        toast.success(`Subscription reconciled — tier is now ${String(data.tier).toUpperCase()}`);
        setTier(data.tier);
      } else if (data.tier === "free") {
        toast.info("No active subscription found.");
      } else {
        toast.success(`Subscription confirmed: ${String(data.tier).toUpperCase()} (${data.status})`);
      }
    } catch {
      toast.error("Could not verify subscription status.");
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => {
    const wallet = publicKey?.toBase58() || "";
    loadStatsFromDb(wallet).then(setStats);
    fetchStatus();
  }, [publicKey]);

  const meta = TIER_META[tier] ?? TIER_META.free;
  const isPaid = tier !== "free";

  const purchaseNotifs = useMemo(
    () =>
      notifications
        .filter((n) => n.type === "purchase" || n.type === "install")
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10),
    [notifications],
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
      {/* Header card */}
      <section className="relative rounded-3xl border border-violet-100 bg-white p-7 sm:p-8 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-violet-300/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 h-64 w-64 rounded-full bg-violet-400/10 blur-3xl" />

        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2.5">
              <DreyvStar size={10} className="text-violet-600" />
              <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Plan & usage</span>
            </div>
            <h2 className="mt-2 text-[24px] sm:text-[26px] font-semibold tracking-[-0.01em] text-slate-900">
              Dreyv OS <span className="italic font-light text-violet-600">{meta.label}</span>
            </h2>
            <p className="mt-1 text-[13px] text-slate-500 max-w-xl">
              {isPaid
                ? "Billed monthly via Paystack. Manage invoices and payment method below."
                : "You're on the free tier. Upgrade any time — pricing is flat, no per-tx markup."}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold tracking-[0.18em] uppercase ${
                isPaid
                  ? "bg-violet-50 text-violet-700 border-violet-200"
                  : "bg-slate-100 text-slate-600 border-slate-200"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isPaid ? "bg-violet-600" : "bg-slate-400"}`} />
              {isPaid ? `Active · ${status || "current"}` : "Free tier"}
            </span>
            <button
              onClick={handleVerify}
              disabled={verifying}
              className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] uppercase text-slate-500 hover:text-violet-700 transition"
            >
              {verifying ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Verify status
            </button>
          </div>
        </div>

        {/* Plan details */}
        <div className="relative z-10 mt-6 grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2 rounded-2xl border border-violet-100 bg-white p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-[10px] tracking-[0.2em] uppercase font-semibold text-violet-700">Current tier</p>
                <p className="mt-1 text-[20px] font-semibold tracking-[-0.01em] text-slate-900">
                  {meta.label} <span className="text-slate-400 text-[14px] font-normal">· {meta.price}</span>
                </p>
              </div>
              {meta.cta && (
                <a
                  href="/pricing"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold tracking-[0.06em] transition shadow-[0_12px_30px_-12px_rgba(124,58,237,0.6)]"
                >
                  <ArrowRight size={13} /> {meta.cta}
                </a>
              )}
            </div>

            <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2.5">
              {meta.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-[12.5px] text-slate-700">
                  <CheckCircle2 size={14} className="text-violet-600 mt-0.5 shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {/* Stats row */}
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <StatCard icon={Package} label="Apps created" value={stats.appsCreated} />
              <StatCard icon={Store} label="Listings" value={stats.appsListed} />
              <StatCard icon={ShoppingCart} label="Purchased" value={stats.appsPurchased} />
              <StatCard icon={Bell} label="Notifications" value={notifications.length} />
            </div>
          </div>

          {/* Revenue / spend */}
          <div className="rounded-2xl border border-violet-100 bg-white p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2">
                <BarChart3 size={13} className="text-violet-600" />
                <p className="text-[10px] tracking-[0.2em] uppercase font-semibold text-violet-700">Revenue</p>
              </div>
              <p className="mt-2 text-[26px] font-semibold tracking-[-0.01em] text-slate-900">
                {stats.totalEarnedSol.toFixed(2)} <span className="text-[12px] font-mono text-slate-500">SOL</span>
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                From {stats.appsListed} marketplace listing{stats.appsListed !== 1 ? "s" : ""}
              </p>
            </div>

            <div className="mt-6 pt-5 border-t border-violet-100">
              <div className="flex items-center gap-2">
                <ShoppingCart size={13} className="text-violet-600" />
                <p className="text-[10px] tracking-[0.2em] uppercase font-semibold text-violet-700">Spent</p>
              </div>
              <p className="mt-2 text-[22px] font-semibold tracking-[-0.01em] text-slate-900">
                {stats.totalSpentSol.toFixed(2)} <span className="text-[12px] font-mono text-slate-500">SOL</span>
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Across {stats.appsPurchased} purchase{stats.appsPurchased !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Transaction history */}
      <section className="rounded-3xl border border-violet-100 bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-violet-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <DreyvStar size={9} className="text-violet-600" />
            <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Transaction history</span>
          </div>
          <span className="text-[11px] font-mono text-slate-500">
            {purchaseNotifs.length} recent
          </span>
        </div>

        {purchaseNotifs.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-[13px] text-slate-600">No transactions yet.</p>
            <p className="mt-1 text-[12px] text-slate-500">Marketplace purchases and installs will land here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-violet-100">
            {purchaseNotifs.map((n) => (
              <li key={n.id} className="px-6 py-3.5 flex items-center justify-between gap-3 hover:bg-violet-50/40 transition group">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="h-9 w-9 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center text-violet-600 shrink-0">
                    {n.type === "purchase" ? <ShoppingCart size={14} /> : <Package size={14} />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-900 truncate">{n.title}</p>
                    <p className="text-[11px] text-slate-500 font-mono">
                      {formatDistanceToNow(new Date(n.timestamp), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-[0.18em] uppercase text-violet-700">
                  {n.type === "purchase" ? "Purchase" : "Install"}
                  <ArrowUpRight size={11} className="opacity-60 group-hover:opacity-100 transition" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value }: { icon: any; label: string; value: number }) => (
  <div className="rounded-2xl border border-violet-100 bg-white p-3.5">
    <Icon size={14} className="text-violet-600" />
    <p className="mt-2 text-[20px] font-semibold tracking-[-0.01em] text-slate-900">{value}</p>
    <p className="text-[10px] tracking-[0.18em] uppercase font-semibold text-slate-500 mt-0.5">{label}</p>
  </div>
);
