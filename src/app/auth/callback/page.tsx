"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { useConnect, usePhantom } from "@phantom/react-sdk";
import { useWallet } from "@/lib/wallet/compat";
import { useKeystoneAuth } from "@/hooks/useKeystoneAuth";

const PHANTOM_SOCIAL_PENDING_KEY = "dreyv_phantom_social_pending";

function getRedirectTarget() {
  if (typeof window === "undefined") return "/app";
  const target = sessionStorage.getItem("dreyv_post_auth_redirect") || "/app";
  return target.startsWith("/") && !target.startsWith("//") ? target : "/app";
}

function clearPhantomCallbackState() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PHANTOM_SOCIAL_PENDING_KEY);
  sessionStorage.removeItem("dreyv_post_auth_redirect");
}

export default function PhantomAuthCallbackPage() {
  const { connected, publicKey } = useWallet();
  const { isConnecting, error: connectError } = useConnect();
  const { isLoading: phantomLoading, errors: phantomErrors } = usePhantom();
  const { isAuthenticated, isLoading, step, error } = useKeystoneAuth();
  const [resumeTimedOut, setResumeTimedOut] = useState(false);

  const [callbackError, setCallbackError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const description = params.get("error_description");
    const code = params.get("error");
    setCallbackError(description || code);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isAuthenticated) {
      const target = getRedirectTarget();
      clearPhantomCallbackState();
      window.location.href = target;
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (connected || isAuthenticated) return;
    const timer = window.setTimeout(() => setResumeTimedOut(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [connected, isAuthenticated]);

  const failed = callbackError || connectError || phantomErrors?.connect || error || (resumeTimedOut ? "We couldn't resume the Phantom login session. Please try Phantom Google/Apple again from this same tab." : null);
  const failedMessage = failed instanceof Error ? failed.message : failed ? String(failed) : null;
  const isBusy = phantomLoading || isConnecting || isLoading || step === "connecting" || step === "signing" || step === "verifying";

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-12 font-sans text-slate-900">
      <section className="w-full max-w-md rounded-3xl border border-violet-100 bg-white p-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-200 bg-violet-50 text-violet-600">
          {failed ? <AlertCircle className="h-7 w-7" /> : isAuthenticated ? <ShieldCheck className="h-7 w-7" /> : <Loader2 className="h-7 w-7 animate-spin" />}
        </div>
        <h1 className="text-xl font-extrabold tracking-tight text-slate-950">Completing Phantom login</h1>
        <p className="mt-3 text-sm font-medium leading-6 text-slate-600">
          {failedMessage
            ? failedMessage
            : isBusy
              ? "Securing your Phantom session…"
              : connected
                ? publicKey
                  ? `Verifying wallet ${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}…`
                  : "Verifying wallet ownership…"
                : "Finishing the Google or Apple handoff from Phantom…"}
        </p>
        {failed && (
          <button
            type="button"
            onClick={() => { clearPhantomCallbackState(); window.location.href = "/auth"; }}
            className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-violet-600 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-violet-700"
          >
            Back to sign in
          </button>
        )}
      </section>
    </main>
  );
}