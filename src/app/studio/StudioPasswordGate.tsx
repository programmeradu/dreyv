"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function StudioPasswordGate() {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/studio/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Wrong password");
        setLoading(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-white px-6 text-[#0B0820]"
      style={{ fontFamily: "Manrope, ui-sans-serif, system-ui" }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-3xl border border-violet-200 bg-white p-8"
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-700">
          Dreyv · Studio
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">Enter password</h1>
        <p className="mt-2 text-sm text-[#0B0820]/65">
          This workspace is private. Enter the studio password to continue.
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="mt-5 w-full rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm outline-none focus:border-violet-500"
        />
        {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
        <button
          type="submit"
          disabled={loading || !password}
          className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {loading ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
