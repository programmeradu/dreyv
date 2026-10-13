"use client";

/**
 * Public marketplace install/checkout entry point.
 *
 * - Anonymous visitor → must connect wallet to install/buy.
 * - Free app  → calls `installApp` server action (records userInstalledApps).
 * - Paid app  → opens PurchaseModal which builds + signs a USDC tx,
 *               verifies on-chain via /api/studio/marketplace/purchase,
 *               then installs.
 */
import React, { useState } from "react";
import { useWallet } from "@/lib/wallet/compat";
import { PurchaseModal } from "@/components/studio/PurchaseModal";
import { installApp } from "@/actions/studio-actions";
import { toast } from "@/lib/toast-notifications";
import { Loader2, ExternalLink } from "lucide-react";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";

interface MiniAppLite {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  priceUsdc: number;
  creatorWallet: string;
}

export function InstallButton({ app }: { app: MiniAppLite }) {
  const { publicKey, connected } = useWallet();
  const [busy, setBusy] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);

  const isFree = app.priceUsdc === 0;
  const label = isFree ? "Install free" : `Install for ${app.priceUsdc} USDC`;

  async function installFree() {
    if (!connected || !publicKey) {
      toast.error("Connect a wallet to install.");
      return;
    }
    setBusy(true);
    try {
      const res = await installApp(publicKey.toBase58(), app.id);
      if (res?.success) {
        toast.success(res.message === "Already installed" ? "Already in your library." : "Installed.");
      } else {
        toast.error(res?.error ?? "Install failed");
      }
    } catch (e) {
      toast.error(`Install failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function onPaid() {
    if (!connected) {
      toast.error("Connect a wallet to purchase.");
      return;
    }
    setPurchaseOpen(true);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={isFree ? installFree : onPaid}
        disabled={busy}
        className={marketingPrimaryCtaSm}
      >
        {busy && <Loader2 size={14} className="animate-spin" />}
        {label}
      </button>
      <a
        href={`/app/marketplace/${app.id}`}
        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-violet-700 hover:text-violet-900 border border-violet-200 hover:border-violet-400 bg-white"
      >
        Open in dreyv <ExternalLink size={12} />
      </a>

      {!isFree && (
        <PurchaseModal
          open={purchaseOpen}
          onOpenChange={setPurchaseOpen}
          app={{
            id: app.id,
            name: app.name,
            priceUsdc: app.priceUsdc,
            creatorWallet: app.creatorWallet,
            description: app.description,
            category: app.category,
            version: app.version,
          }}
          onSuccess={() => {
            toast.success("Purchase complete — app installed.");
            setPurchaseOpen(false);
          }}
        />
      )}
    </div>
  );
}
