"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { isValidSolanaAddress } from "@/lib/atlas-utils";

const TOOLS = [
  { name: "Squads", logo: "/logos/squads.png" },
  { name: "Jupiter", logo: "/logos/jup.png" },
  { name: "Birdeye", logo: "/logos/birdeye.png" },
  { name: "Helius", logo: "/logos/helius.png" },
  { name: "Marinade", logo: "/logos/marinade.png" },
  { name: "Jito", logo: "/logos/jito.png" },
  { name: "Phantom", logo: "/logos/phantom.png" },
  { name: "Dune", logo: "/logos/dune.png" },
];

/**
 * Hero "paste-vault" CTA. Replaces the old typewriter loop with a real input
 * that routes any pasted Solana wallet to /v/[address] for a read-only
 * preview (Sid's "no signature, just see it" pitch). Empty submits scroll to
 * the live HomeCommandbar simulator below.
 */
export function HeroCommandbarDemo() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      const demo = document.getElementById("demo");
      if (demo) demo.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (!isValidSolanaAddress(trimmed)) {
      setError("That doesn't look like a Solana address. Paste any wallet pubkey.");
      return;
    }
    setError(null);
    setSubmitting(true);
    window.location.href = `/v/${encodeURIComponent(trimmed)}`;
  }

  return (
    <div className="relative w-full max-w-lg">
      <div className="absolute -inset-10 bg-violet-400/[0.12] blur-[90px] rounded-full pointer-events-none" />

      <form
        onSubmit={onSubmit}
        toolname="preview-solana-wallet"
        tooldescription="Open a read-only Dreyv portfolio preview for any Solana wallet address."
        toolautosubmit="false"
        className="relative rounded-2xl bg-white ring-1 ring-slate-200/80 marketing-shadow-float p-2.5"
      >
        <div className="flex items-center gap-2.5 rounded-xl bg-slate-50/80 ring-1 ring-slate-200/70 px-3.5 py-3">
          <DreyvStar size={16} className="text-violet-600 shrink-0" />
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            name="wallet"
            toolparamdescription="A base58-encoded Solana wallet address (32–44 chars)."
            placeholder="Paste any Solana wallet to preview it…"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 bg-transparent text-[14px] font-medium text-slate-900 placeholder:text-slate-400 outline-none"
            aria-label="Solana wallet address"
            inputMode="text"
            disabled={submitting}
          />
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white hover:bg-violet-500 transition-colors disabled:opacity-50"
            aria-label="Open preview"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 px-1.5 pt-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.28em] text-slate-400">
            <ShieldCheck className="h-3 w-3 text-violet-500" />
            Read-only · no signature
          </span>
          <button
            type="button"
            onClick={() => {
              const demo = document.getElementById("demo");
              if (demo) demo.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="text-[11px] font-medium text-violet-700 hover:text-violet-900"
          >
            Or try the simulator ↓
          </button>
        </div>
        {error && (
          <p className="mt-2 px-1.5 text-[11px] font-medium text-rose-600">{error}</p>
        )}
      </form>

      <div className="relative mt-6">
        <p className="text-center text-[10px] font-mono uppercase tracking-[0.28em] text-slate-400 mb-3">
          Replaces 10+ tabs
        </p>
        <div className="relative flex flex-wrap items-center justify-center gap-x-5 gap-y-2.5">
          {TOOLS.map((tool) => (
            <div
              key={tool.name}
              className="group flex items-center gap-1.5 opacity-55 hover:opacity-90 transition-opacity"
            >
              <img
                src={tool.logo}
                alt=""
                loading="lazy"
                className="h-4 w-4 rounded-sm grayscale"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <span className="text-[12px] font-medium text-slate-500 line-through decoration-violet-400/70 decoration-[1.5px]">
                {tool.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
