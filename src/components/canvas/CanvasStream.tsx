"use client";

/**
 * CanvasStream — vertical, draggable list of CanvasBlocks.
 *
 * Pinned blocks render at the top; ephemeral blocks below are reorderable.
 * Empty state nudges the user toward the CommandBar (no palette button —
 * the CommandBar is the single entry point per design rules).
 */

import { Reorder, AnimatePresence, motion } from "framer-motion";
import { useCanvas } from "@/lib/canvas/CanvasContext";
import { CanvasBlockView } from "./blocks/CanvasBlockView";

export function CanvasStream() {
  const { blocks, reorderBlocks } = useCanvas();
  const pinned = blocks.filter((b) => b.pinned);
  const ephemeral = blocks.filter((b) => !b.pinned);

  if (blocks.length === 0) {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-violet-200/70 bg-white px-6 py-16 text-center">
        {/* Brand-native ambient mark — no stock icon */}
        <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-40 w-40 -translate-y-1/2 rounded-full bg-violet-400/30 blur-3xl" />
        <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600 shadow-[0_10px_40px_-10px_rgba(124,58,237,0.6)]">
          <span className="font-manrope text-xl font-bold text-white">D</span>
        </div>
        <h3 className="relative mt-5 font-manrope text-lg font-semibold tracking-tight text-slate-900">
          Your canvas is quiet
        </h3>
        <p className="relative mt-1 text-sm text-slate-600">
          Ask Dreyv anything below — every answer, plan, and insight will land here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {pinned.length > 0 && (
        <div className="space-y-3">
          {pinned.map((b) => (
            <motion.div
              key={b.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <CanvasBlockView block={b} />
            </motion.div>
          ))}
        </div>
      )}

      {ephemeral.length > 0 && (
        <Reorder.Group
          axis="y"
          values={ephemeral.map((b) => b.id)}
          onReorder={(ids) =>
            reorderBlocks([...pinned.map((p) => p.id), ...(ids as string[])])
          }
          className="space-y-3"
        >
          <AnimatePresence initial={false}>
            {ephemeral.map((b) => (
              <Reorder.Item
                key={b.id}
                value={b.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="cursor-grab active:cursor-grabbing"
              >
                <CanvasBlockView block={b} />
              </Reorder.Item>
            ))}
          </AnimatePresence>
        </Reorder.Group>
      )}
    </div>
  );
}
