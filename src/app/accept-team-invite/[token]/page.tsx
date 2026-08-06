"use client";

/**
 * `/accept-team-invite/[token]` — clean, brand-aligned team invitation acceptance.
 * Replaces the legacy `/app/team?accept=…` query-string flow.
 *
 * Flow:
 *  1. Land on URL with token in the path.
 *  2. If wallet is not connected → show CTA to connect (preserves token through redirect).
 *  3. If connected → call POST /api/team/accept-invite, then redirect to /app/team.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWallet } from "@/lib/wallet/compat";
import { WalletButton } from "@/components/WalletButton";
import { ArrowLeft, CheckCircle2, AlertTriangle, Loader2, Sparkles, Users } from "lucide-react";
import {
  AmbientGlow,
  Surface,
  StreamIn,
  Pill,
} from "@/components/app-shell/primitives";

type Status = "needs-wallet" | "accepting" | "success" | "error";

export const runtime = "edge";
export default function AcceptTeamInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const wallet = useWallet();
  const token = params?.token ?? "";

  const [status, setStatus] = useState<Status>("needs-wallet");
  const [message, setMessage] = useState<string>("");
  const [teamId, setTeamId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("This invitation link is missing its token.");
      return;
    }
    if (!wallet?.connected) {
      setStatus("needs-wallet");
      return;
    }
    // Fire once when the wallet becomes connected
    if (status !== "needs-wallet") return;

    let cancelled = false;
    (async () => {
      setStatus("accepting");
      try {
        const res = await fetch("/api/team/accept-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          setMessage(data?.error || "We couldn’t accept this invitation.");
          return;
        }
        setStatus("success");
        setTeamId(data?.teamId ?? null);
        // Auto-redirect after a beat so the user sees the confirmation
        setTimeout(() => router.push("/app/team"), 1800);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setMessage("Network error while accepting the invitation.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, wallet?.connected, status, router]);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-white font-manrope text-slate-900">
      <AmbientGlow className="left-[-160px] top-[-200px]" />
      <AmbientGlow className="right-[-160px] bottom-[-200px]" />

      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-violet-700">
          <ArrowLeft className="h-4 w-4" />
          Home
        </Link>
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-violet-600 text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          dreyv
        </Link>
        <WalletButton />
      </header>

      <main className="relative z-10 mx-auto mt-12 flex max-w-2xl flex-col items-center px-6 pb-24">
        <StreamIn className="w-full text-center">
          <Pill tone="violet">Team invitation</Pill>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">
            You’ve been invited to a treasury team.
          </h1>
          <p className="mx-auto mt-3 max-w-md text-base text-slate-600">
            Accept to join, see the team’s vault, and start co-signing transactions.
          </p>
        </StreamIn>

        <StreamIn delay={0.1} className="mt-10 w-full">
          <Surface className="p-8">
            <div className="flex flex-col items-center gap-5 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-violet-700">
                {status === "accepting" ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : status === "success" ? (
                  <CheckCircle2 className="h-6 w-6" />
                ) : status === "error" ? (
                  <AlertTriangle className="h-6 w-6 text-rose-600" />
                ) : (
                  <Users className="h-6 w-6" />
                )}
              </div>

              {status === "needs-wallet" && (
                <>
                  <p className="text-base font-medium text-slate-900">
                    Connect your Solana wallet to accept this invitation.
                  </p>
                  <p className="text-sm text-slate-500">
                    Your wallet address is how the team recognises you and how you’ll co-sign vault transactions.
                  </p>
                  <div className="mt-2">
                    <WalletButton />
                  </div>
                </>
              )}

              {status === "accepting" && (
                <>
                  <p className="text-base font-medium text-slate-900">Accepting your invitation…</p>
                  <p className="text-sm text-slate-500">One moment while we add you to the team.</p>
                </>
              )}

              {status === "success" && (
                <>
                  <p className="text-base font-medium text-slate-900">You’re in.</p>
                  <p className="text-sm text-slate-500">
                    Taking you to your team workspace…
                  </p>
                  <Link
                    href="/app/team"
                    className="mt-3 inline-flex items-center justify-center rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700"
                  >
                    Go to team workspace
                  </Link>
                </>
              )}

              {status === "error" && (
                <>
                  <p className="text-base font-medium text-slate-900">We couldn’t accept this invitation.</p>
                  <p className="text-sm text-slate-500">{message}</p>
                  <Link
                    href="/app"
                    className="mt-3 inline-flex items-center justify-center rounded-xl border border-violet-200 bg-white px-5 py-2.5 text-sm font-semibold text-violet-700 transition hover:bg-violet-50"
                  >
                    Back to dreyv
                  </Link>
                </>
              )}
            </div>
          </Surface>
        </StreamIn>

        {teamId && status === "success" && (
          <p className="mt-6 text-xs text-slate-400">Team ID: {teamId.slice(0, 8)}…</p>
        )}
      </main>
    </div>
  );
}
