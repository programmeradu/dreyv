'use client';

import { useEffect, useState, useRef } from 'react';
import { useToastStore, type Toast } from '@/lib/toast-notifications';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, AlertTriangle, XCircle, Sparkles, ArrowRight } from 'lucide-react';

/**
 * Premium light-themed toast palette — matches Atlas/Dreyv violet-forward UI.
 * Each variant defines: icon, accent (left bar + dot + action btn), soft tinted bg for icon halo.
 */
const TOAST_CONFIG = {
  success: {
    icon: CheckCircle2,
    accent: 'rgb(16, 185, 129)',         // emerald-500
    accentSoft: 'rgba(16, 185, 129, 0.10)',
    accentRing: 'rgba(16, 185, 129, 0.22)',
    badgeBg: 'rgba(16, 185, 129, 0.10)',
    badgeText: 'rgb(4, 120, 87)',         // emerald-700
  },
  error: {
    icon: XCircle,
    accent: 'rgb(244, 63, 94)',           // rose-500
    accentSoft: 'rgba(244, 63, 94, 0.10)',
    accentRing: 'rgba(244, 63, 94, 0.22)',
    badgeBg: 'rgba(244, 63, 94, 0.10)',
    badgeText: 'rgb(190, 18, 60)',
  },
  warning: {
    icon: AlertTriangle,
    accent: 'rgb(245, 158, 11)',          // amber-500
    accentSoft: 'rgba(245, 158, 11, 0.12)',
    accentRing: 'rgba(245, 158, 11, 0.25)',
    badgeBg: 'rgba(245, 158, 11, 0.12)',
    badgeText: 'rgb(180, 83, 9)',
  },
  info: {
    icon: Sparkles,
    accent: 'rgb(139, 92, 246)',          // violet-500 — brand
    accentSoft: 'rgba(139, 92, 246, 0.10)',
    accentRing: 'rgba(139, 92, 246, 0.22)',
    badgeBg: 'rgba(139, 92, 246, 0.10)',
    badgeText: 'rgb(109, 40, 217)',       // violet-700
  },
};

/**
 * Toast Container — top-right, stacked, max ~380px wide
 */
export function ToastContainer() {
  const { toasts, dismissToast } = useToastStore();

  return (
    <div
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2.5 pointer-events-none"
      style={{ maxWidth: 380 }}
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((t, i) => (
          <ToastItem
            key={t.id}
            toast={t}
            index={i}
            onDismiss={() => dismissToast(t.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * Individual premium light toast — white card, colored left bar, soft ring,
 * optional uppercase badge, optional filled pill action button.
 */
function ToastItem({ toast, index, onDismiss }: { toast: Toast; index: number; onDismiss: () => void }) {
  const config = TOAST_CONFIG[toast.type] || TOAST_CONFIG.info;
  const Icon = config.icon;
  const isDismissing = !!toast.dismissedAt;

  // Progress bar (subtle, sits at bottom)
  const [progress, setProgress] = useState(100);
  const startRef = useRef(toast.timestamp);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (toast.duration <= 0 || isDismissing) return;
    startRef.current = toast.timestamp;

    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const remaining = Math.max(0, 100 - (elapsed / toast.duration) * 100);
      setProgress(remaining);
      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [toast.duration, toast.timestamp, isDismissing]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.94, filter: 'blur(2px)' }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      className="pointer-events-auto relative overflow-hidden rounded-xl group"
      style={{
        background: '#ffffff',
        border: '1px solid rgb(226, 232, 240)', // slate-200
        boxShadow:
          '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -8px rgba(15, 23, 42, 0.10), 0 0 0 1px rgba(255,255,255,0.6) inset',
      }}
    >
      {/* Left accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: config.accent }}
      />

      <div className="flex items-start gap-3 pl-4 pr-3 py-3">
        {/* Icon halo */}
        <div
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 ring-1 ring-inset"
          style={{
            background: config.accentSoft,
            // @ts-ignore — using --tw-ring style via inline ringColor
            boxShadow: `inset 0 0 0 1px ${config.accentRing}`,
          }}
        >
          <Icon size={15} style={{ color: config.accent }} strokeWidth={2.4} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 py-0.5">
          {/* Title row + optional badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-semibold text-slate-900 leading-tight">
              {toast.title}
            </p>
            {toast.badge && (
              <span
                className="inline-flex items-center text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                style={{
                  background: config.badgeBg,
                  color: config.badgeText,
                }}
              >
                {toast.badge}
              </span>
            )}
          </div>

          {toast.message && (
            <p className="text-[12px] text-slate-500 mt-0.5 leading-snug line-clamp-2">
              {toast.message}
            </p>
          )}

          {toast.action && (
            <button
              onClick={() => { toast.action?.onClick(); onDismiss(); }}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-white px-2.5 py-1 rounded-full transition-all hover:brightness-110 hover:shadow-sm active:scale-95"
              style={{ background: config.accent }}
            >
              {toast.action.label}
              <ArrowRight size={11} strokeWidth={2.5} />
            </button>
          )}
        </div>

        {/* Close */}
        <button
          onClick={onDismiss}
          className="shrink-0 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors mt-0.5"
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      </div>

      {/* Progress bar — ultra-subtle */}
      {toast.duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-slate-100">
          <motion.div
            className="h-full"
            style={{
              background: config.accent,
              width: `${progress}%`,
              opacity: 0.55,
            }}
            transition={{ duration: 0.1, ease: 'linear' }}
          />
        </div>
      )}
    </motion.div>
  );
}
