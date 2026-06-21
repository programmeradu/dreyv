"use client";

import { useState, FormEvent } from "react";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";
import { Mail, Check, AlertCircle } from "lucide-react";

export function SubscribeForm({ slug }: { slug: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`/api/public/status/${slug}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Unable to subscribe");
      }
      setState("sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to subscribe");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        <Check size={16} />
        Check your inbox to confirm your subscription.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-2">
      <div className="relative flex-1">
        <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400"
        />
      </div>
      <button
        type="submit"
        disabled={state === "loading"}
        className={marketingPrimaryCtaSm + " disabled:opacity-60 disabled:cursor-not-allowed justify-center"}
      >
        {state === "loading" ? "Subscribing…" : "Subscribe"}
      </button>
      {error && (
        <p className="sm:absolute sm:mt-14 flex items-center gap-1.5 text-xs text-rose-600">
          <AlertCircle size={12} /> {error}
        </p>
      )}
    </form>
  );
}
