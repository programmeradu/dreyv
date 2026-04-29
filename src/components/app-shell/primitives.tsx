"use client";

/**
 * Shared visual primitives for the new generative app shell.
 * Stitch-light DNA: white bg, solid violet (#7c3aed), Manrope, ambient glows.
 *
 * No technical chrome — these primitives speak in human outcomes only.
 */

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Violet ambient glow that sits behind hero content. */
export function AmbientGlow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute -z-10 blur-3xl",
        className,
      )}
    >
      <div className="h-[420px] w-[420px] rounded-full bg-violet-300/40" />
    </div>
  );
}

/**
 * Flat surface card. No shadows, no blur, no gradients, no ring.
 * Cards lie flat on the page background — borders only.
 *
 * `glow` is kept as a no-op for prop compatibility; it intentionally
 * adds NO visual effect (per analytics design rules: flat only).
 */
export function Surface({
  children,
  className,
  glow: _glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative rounded-3xl border border-violet-100 bg-white",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Animated count-up for big monetary or numeric outcomes. */
export function StreamingNumber({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  className,
  duration = 1.2,
}: {
  value: number | null | undefined;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
  duration?: number;
}) {
  const target = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { duration: duration * 1000, bounce: 0 });
  const display = useTransform(spring, (v) =>
    `${prefix}${v.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`,
  );

  useEffect(() => {
    mv.set(target);
  }, [target, mv]);

  if (value === null || value === undefined) {
    return <span className={cn("text-slate-300", className)}>—</span>;
  }
  return <motion.span className={className}>{display}</motion.span>;
}

/** Flat status pill — bordered, no ring/shadow. */
export function Pill({
  children,
  tone = "violet",
  className,
}: {
  children: ReactNode;
  tone?: "violet" | "emerald" | "rose" | "slate" | "amber";
  className?: string;
}) {
  const tones: Record<string, string> = {
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    slate: "bg-slate-50 text-slate-600 border-slate-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Section heading used across the shell. */
export function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="space-y-2">
      {eyebrow && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
          {eyebrow}
        </p>
      )}
      <h2 className="font-manrope text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
        {title}
      </h2>
      {description && (
        <p className="max-w-xl text-sm leading-relaxed text-slate-600">{description}</p>
      )}
    </div>
  );
}

/** Soft fade-in wrapper used to stream content in sequentially. */
export function StreamIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
