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

/** Soft violet card surface used everywhere in the new shell. */
export function Surface({
  children,
  className,
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative rounded-3xl border border-violet-200/60 bg-white/80 backdrop-blur-sm",
        "shadow-[0_1px_0_0_rgba(124,58,237,0.04),0_24px_48px_-24px_rgba(124,58,237,0.18)]",
        glow && "ring-1 ring-violet-200/50",
        className,
      )}
    >
      {glow && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-4 -top-6 h-24 rounded-full bg-violet-300/25 blur-2xl -z-10"
        />
      )}
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

/** Soft violet pill used for status / tags — never used for ID chips. */
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
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
    slate: "bg-slate-50 text-slate-600 ring-slate-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1",
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
