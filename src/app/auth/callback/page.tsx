"use client";

import { useEffect } from "react";
import { Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { useConnect } from "@phantom/react-sdk";
import { useWallet } from "@/lib/wallet/compat";
import { useKeystoneAuth } from "@/hooks/useKeystoneAuth";

export default function PhantomAuthCallbackPage() {
  const { connected, publicKey } = useWallet();
  const { isConnecting, error: connectError } = useConnect();
  const { isAuthenticated, isLoading, step, error } = useKeystoneAuth();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isAuthenticated) {
      sessionStorage.removeItem("dreyv_phantom_social_pending");
      window.location.href = "/app";
    }
  }, [isAuthenticated]);

  const failed = connectError || error;
  const failedMessage = failed instanceof Error ? failed.message : failed ? String(failed) : null;

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
            : isConnecting || isLoading
              ? "Securing your Phantom session…"
              : connected
                ? "Verifying wallet ownership…"
                : "Finishing the Google or Apple handoff from Phantom…"}
        </p>
        {failed && (
          <button
            type="button"
            onClick={() => { window.location.href = "/auth"; }}
            className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-violet-600 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-violet-700"
          >
            Back to sign in
          </button>
        )}
      </section>
    </main>
  );
}