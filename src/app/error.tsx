"use client"; // Error boundaries must be client components

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { DreyvMark } from "@/components/brand/dreyv-mark";
import heroLiquid from "@/assets/hero-liquid-violet.png";

function ArrowMark({ className = "", direction = "right" }: { className?: string; direction?: "right" | "left" | "refresh" }) {
  if (direction === "refresh") {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        <path d="M3 8a5 5 0 0 1 8.5-3.5L13 6" />
        <path d="M13 3 V6 H10" />
        <path d="M13 8a5 5 0 0 1-8.5 3.5L3 10" />
        <path d="M3 13 V10 H6" />
      </svg>
    );
  }
  if (direction === "left") {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        <path d="M12 8 H4" />
        <path d="M7 4 L4 8 L7 12" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 8 H12" />
      <path d="M9 4 L12 8 L9 12" />
    </svg>
  );
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Global Error]", error);
  }, [error]);

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-marketing-bg-low text-slate-900 font-manrope selection:bg-violet-200/70">
      {/* Ambient violet wash */}
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
        <div className="absolute top-[-14%] left-[-12%] h-[640px] w-[640px] rounded-full bg-violet-400/[0.11] blur-[130px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[520px] w-[520px] rounded-full bg-violet-400/[0.10] blur-[120px]" />
        <div className="absolute inset-0 grid-pattern-marketing opacity-[0.45]" />
      </div>

      {/* Floating liquid violet accent */}
      <div className="pointer-events-none absolute -top-20 -right-24 w-[440px] h-[440px] opacity-[0.18] z-0" aria-hidden>
        <Image src={heroLiquid} alt="" fill sizes="440px" priority className="object-contain mix-blend-multiply" />
      </div>

      <div className="relative z-10 w-full max-w-xl px-6 text-center">
        {/* Brand mark + status dot */}
        <div className="flex justify-center mb-8">
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl bg-white ring-1 ring-violet-200/70 marketing-shadow-float flex items-center justify-center">
              <DreyvMark size={28} />
            </div>
            <span
              className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-violet-600 ring-4 ring-marketing-bg-low"
              aria-hidden
            />
          </div>
        </div>

        <p className="text-[11px] font-mono uppercase tracking-[0.3em] text-violet-700/90 mb-4">
          Something interrupted the flow
        </p>
        <h1 className="text-3xl md:text-[2.5rem] font-bold tracking-[-0.02em] leading-[1.1] text-slate-900">
          Let&apos;s try that again.
        </h1>
        <p className="mt-5 text-base text-slate-600 max-w-md mx-auto leading-relaxed">
          A page failed to load. Nothing was signed and no funds moved — your treasury is safe. Reload to pick up where
          you left off.
        </p>

        {/* Diagnostic block — quiet, optional */}
        {(error?.message || error?.digest) && (
          <details className="mt-8 mx-auto max-w-md text-left rounded-xl border border-violet-200/50 bg-white/80 backdrop-blur-sm overflow-hidden">
            <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.2em] text-slate-500 hover:text-violet-700 transition-colors">
              <span>Diagnostic</span>
              <span className="text-violet-500">↓</span>
            </summary>
            <div className="px-4 pb-4">
              <code className="block text-[11px] font-mono text-slate-700 break-words bg-violet-50/60 rounded-lg p-3 border border-violet-100">
                {error.message || "Unknown runtime error"}
                {error.digest && (
                  <span className="block mt-2 pt-2 border-t border-violet-100 text-[10px] text-slate-400 uppercase tracking-wider">
                    Digest · {error.digest}
                  </span>
                )}
              </code>
            </div>
          </details>
        )}

        {/* Actions */}
        <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => reset()}
            className="group inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(124,58,237,0.5)] hover:bg-violet-700 transition-colors w-full sm:w-auto"
          >
            <ArrowMark direction="refresh" className="h-4 w-4 transition-transform group-hover:rotate-180 duration-500" />
            <span>Reload page</span>
          </button>
          <Link
            href="/"
            className="group inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-700 ring-1 ring-violet-200/70 hover:ring-violet-400 hover:text-violet-700 transition-all w-full sm:w-auto"
          >
            <ArrowMark direction="left" className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
            <span>Back to home</span>
          </Link>
        </div>

        <p className="mt-10 text-[10px] font-mono uppercase tracking-[0.3em] text-slate-400">
          Non-custodial · Simulation-first · Multisig-native
        </p>
      </div>
    </div>
  );
}
