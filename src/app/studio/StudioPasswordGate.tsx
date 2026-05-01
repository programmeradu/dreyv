"use client";

import * as React from "react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { rememberStudioPass } from "@/lib/media-studio/client-auth";
import { Loader2 } from "lucide-react";

export default function StudioPasswordGate({ onUnlocked }: { onUnlocked?: () => void }) {
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const cleanPassword = password.trim();
    try {
      const res = await fetch("/api/studio/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: cleanPassword }),
      });
      if (!res.ok) {
        setError("Wrong password");
        setLoading(false);
        return;
      }
      rememberStudioPass(cleanPassword);
      if (onUnlocked) {
        onUnlocked();
        return;
      }
      window.location.assign("/studio");
    } catch {
      setError("Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-studio-bg px-6 font-manrope text-studio-fg">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-violet-300/40 blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 right-0 h-[420px] w-[600px] rounded-full bg-violet-400/25 blur-[120px]" />

      <form
        onSubmit={onSubmit}
        className="relative w-full max-w-sm rounded-3xl border border-studio-border bg-white/85 p-8 backdrop-blur"
      >
        <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-studio-violet">
          <DreyvStar size={14} />
          Dreyv · Studio
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">Enter password</h1>
        <p className="mt-2 text-sm leading-6 text-studio-muted">
          This workspace is private. Enter the studio password to continue.
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="mt-5 w-full rounded-xl border border-studio-border bg-white px-4 py-3 text-sm outline-none transition focus:border-studio-violet focus:ring-2 focus:ring-studio-violet/20"
        />
        {error && <div className="mt-2 text-xs font-medium text-destructive">{error}</div>}
        <button
          type="submit"
          disabled={loading || !password}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-studio-violet px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_-10px_rgba(124,58,237,0.55)] transition hover:opacity-95 disabled:opacity-50"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {loading ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
