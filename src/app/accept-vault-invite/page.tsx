"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@/lib/wallet/compat";
import { Shield, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { WalletButton } from "@/components/WalletButton";

type Status = "idle" | "accepting" | "success" | "error" | "needs-wallet";

function AcceptInviteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const wallet = useWallet();
  const token = params.get("token") || "";

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>("");
  const [vault, setVault] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Missing invite token in URL.");
      return;
    }
    if (!wallet.connected) {
      setStatus("needs-wallet");
      setMessage("Connect a Solana wallet to accept this invitation.");
      return;
    }
    if (status === "accepting" || status === "success") return;

    (async () => {
      setStatus("accepting");
      try {
        const res = await fetch("/api/vault/accept-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus("error");
          setMessage(data.error || `Could not accept invite (${res.status})`);
          return;
        }
        setVault(data.vaultAddress || "");
        setStatus("success");
        setMessage("You're in. Redirecting to the shared vault…");
        // Persist as active vault so the dashboard auto-connects
        try { localStorage.setItem("dreyv:active-vault", data.vaultAddress); } catch {}
        setTimeout(() => router.push("/app"), 1400);
      } catch (e: any) {
        setStatus("error");
        setMessage(e?.message || "Network error while accepting invite.");
      }
    })();
  }, [token, wallet.connected, status, router]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-md p-8 rounded-2xl bg-card border border-border shadow-lg">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center text-primary mb-5">
          <Shield size={20} />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-1">Accept vault invite</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Join an existing Squads multisig on Dreyv to co-sign treasury proposals.
        </p>

        <div className="rounded-xl border border-border bg-muted/30 p-4 mb-5">
          {status === "needs-wallet" && (
            <>
              <p className="text-xs text-muted-foreground mb-3">{message}</p>
              <WalletButton />
            </>
          )}
          {status === "accepting" && (
            <div className="flex items-center gap-3 text-sm text-foreground">
              <Loader2 className="animate-spin text-primary" size={16} />
              Verifying invite and binding your wallet…
            </div>
          )}
          {status === "success" && (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="text-primary shrink-0 mt-0.5" size={18} />
              <div>
                <p className="text-sm font-semibold text-foreground">Welcome aboard.</p>
                <p className="text-xs text-muted-foreground mt-0.5">{message}</p>
                {vault && (
                  <p className="text-[11px] font-mono text-muted-foreground mt-2 break-all">{vault}</p>
                )}
              </div>
            </div>
          )}
          {status === "error" && (
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-destructive shrink-0 mt-0.5" size={18} />
              <div>
                <p className="text-sm font-semibold text-foreground">Could not accept invite</p>
                <p className="text-xs text-muted-foreground mt-0.5">{message}</p>
              </div>
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Invites are single-use and expire automatically. The wallet you connect becomes a permanent member of the
          vault's signer team.
        </p>
      </div>
    </div>
  );
}

export default function AcceptVaultInvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AcceptInviteInner />
    </Suspense>
  );
}
