'use client';

import { useEffect, useState, useRef } from 'react';
import { useToastStore, type Toast } from '@/lib/toast-notifications';
import { motion, AnimatePresence } from 'framer-motion';

type ToastKind = Toast['type'];

/**
 * Dreyv toast palette — brand-first, no stock status icons and no left rail.
 */
const TOAST_CONFIG: Record<ToastKind, { label: string; title: string }> = {
  success: { label: '✓', title: 'Completed' },
  error: { label: '!', title: 'Attention' },
  warning: { label: '△', title: 'Review' },
  info: { label: '◇', title: 'Signal' },
};

function DreyvToastMark({ type }: { type: ToastKind }) {
  const config = TOAST_CONFIG[type] || TOAST_CONFIG.info;

  return (
    <div
      className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-aurora-violet/20 bg-aurora-violet/10 text-aurora-violet mt-0.5"
      aria-hidden="true"
      title={config.title}
    >
      <svg viewBox="0 0 32 32" className="absolute inset-0 h-full w-full" fill="none">
        <path d="M16 4.5 27.5 16 16 27.5 4.5 16 16 4.5Z" stroke="currentColor" strokeOpacity="0.34" strokeWidth="1.5" />
        <path d="M16 8.5 23.5 16 16 23.5 8.5 16 16 8.5Z" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.25" />
      </svg>
      <span className="relative text-[13px] font-extrabold leading-none text-aurora-violet">
        {config.label}
      </span>
    </div>
  );
}

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
      className="pointer-events-auto relative overflow-hidden rounded-lg border border-border bg-popover shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_28px_-14px_rgba(15,23,42,0.22)] group"
    >
      <div className="flex items-start gap-3 px-3 py-3">
        <DreyvToastMark type={toast.type} />

        {/* Content */}
        <div className="flex-1 min-w-0 py-0.5">
          {/* Title row + optional badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-semibold text-popover-foreground leading-tight">
              {toast.title}
            </p>
            {toast.badge && (
              <span
                className="inline-flex items-center rounded-md bg-aurora-violet/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-aurora-violet"
              >
                {toast.badge}
              </span>
            )}
          </div>

          {toast.message && (
            <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
              {toast.message}
            </p>
          )}

          {toast.action && (
            <button
              onClick={() => { toast.action?.onClick(); onDismiss(); }}
              className="mt-2 inline-flex items-center gap-1 rounded-full bg-aurora-violet px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-all hover:brightness-110 hover:shadow-sm active:scale-95"
            >
              {toast.action.label}
              <span aria-hidden="true" className="text-[12px] leading-none">→</span>
            </button>
          )}
        </div>

        {/* Close */}
        <button
          onClick={onDismiss}
          className="shrink-0 p-1 rounded-md text-muted-foreground/70 hover:text-popover-foreground hover:bg-muted transition-colors mt-0.5"
          aria-label="Dismiss notification"
        >
          <span aria-hidden="true" className="block text-[15px] leading-none">×</span>
        </button>
      </div>

      {/* Progress bar — ultra-subtle */}
      {toast.duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-muted">
          <motion.div
            className="h-full bg-aurora-violet"
            style={{
              width: `${progress}%`,
              opacity: 0.5,
            }}
            transition={{ duration: 0.1, ease: 'linear' }}
          />
        </div>
      )}
    </motion.div>
  );
}
