"use client";

/**
 * `/app-rebuilding` — public placeholder shown while the new generative
 * app shell is being built. Anyone who tries to reach `/app/*` while
 * `DREYV_APP_CONSTRUCTION_MODE=true` lands here.
 */

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Urbanist } from "next/font/google";
import { ArrowRight, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import dryvThink from "@/assets/mascot/dryv-think.png";

const wordmark = Urbanist({
  subsets: ["latin"],
  weight: "600",
  display: "swap",
  adjustFontFallback: true,
});

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
        <Link
          href="/"
          aria-label="dreyv home"
          className="flex items-center group rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500/40"
        >
          <span
            className={cn(
              wordmark.className,
              "text-xl font-semibold tracking-tight text-violet-700 lowercase leading-none group-hover:text-violet-600 transition-colors antialiased",
            )}
          >
            dreyv
          </span>
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
          <div className="flex justify-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="relative"
            >
              <div aria-hidden className="absolute inset-0 -z-10 blur-2xl">
                <div className="mx-auto h-40 w-40 rounded-full bg-violet-300/55" />
              </div>
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              >
                <Image
                  src={dryvThink}
                  alt="Dryv, the Dreyv mascot, tinkering in the workshop"
                  width={180}
                  height={180}
                  priority
                  className="h-44 w-44 select-none object-contain"
                />
              </motion.div>
            </motion.div>
          </div>

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
