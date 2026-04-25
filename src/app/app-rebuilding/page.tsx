"use client";

/**
 * `/app-rebuilding` — public placeholder shown while the new generative
 * app shell is being built. Anyone who tries to reach `/app/*` while
 * `DREYV_APP_CONSTRUCTION_MODE=true` lands here.
 */

import Link from "next/link";
import { motion } from "framer-motion";
import { Sparkles, ArrowRight, Mail } from "lucide-react";

export default function AppRebuildingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-white font-manrope text-slate-900">
      {/* Ambient violet glow */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-220px] -z-10 -translate-x-1/2 blur-3xl">
        <div className="h-[520px] w-[520px] rounded-full bg-violet-300/45" />
      </div>
      <div aria-hidden className="pointer-events-none absolute right-[-160px] bottom-[-200px] -z-10 blur-3xl">
        <div className="h-[420px] w-[420px] rounded-full bg-violet-200/55" />
      </div>

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-violet-600 text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          dreyv
        </Link>
        <Link
          href="/waitlist"
          className="text-sm font-medium text-slate-600 transition-colors hover:text-violet-700"
        >
          Join the waitlist →
        </Link>
      </header>

      <main className="relative z-10 mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-7"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-600 shadow-[0_0_10px_currentColor]" />
            In the workshop
          </span>

          <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
            We’re rebuilding the app.
          </h1>

          <p className="mx-auto max-w-xl text-base leading-relaxed text-slate-600 md:text-lg">
            Dreyv is getting a quieter, smarter, more generative interface — one that hides
            the technical noise and just tells you what your treasury is doing. We’ll be back
            shortly with something we’re proud of.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/waitlist"
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-violet-700 active:scale-[0.98]"
            >
              Get notified when we’re live
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700"
            >
              Back to home
            </Link>
          </div>

          <div className="pt-8 text-xs text-slate-500">
            Need to reach us?{" "}
            <a
              href="mailto:hello@dreyv.com"
              className="inline-flex items-center gap-1 font-medium text-violet-700 hover:text-violet-800"
            >
              <Mail className="h-3 w-3" />
              hello@dreyv.com
            </a>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
