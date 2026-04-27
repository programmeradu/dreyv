"use client";

/**
 * CanvasStream — vertical, draggable list of CanvasBlocks.
 *
 * Pinned blocks render at the top in a fixed order; ephemeral blocks below
 * are reorderable via framer-motion. Empty state nudges the user toward
 * the CommandBar / Palette.
 */

import { Reorder, AnimatePresence, motion } from "framer-motion";
import { Sparkles, Command } from "lucide-react";
import { useCanvas } from "@/lib/canvas/CanvasContext";
import { CanvasBlockView } from "./blocks/CanvasBlockView";

export function CanvasStream({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const { blocks, reorderBlocks } = useCanvas();
  const pinned = blocks.filter((b) => b.pinned);
  const ephemeral = blocks.filter((b) => !b.pinned);

  if (blocks.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-violet-200/80 bg-white/60 px-6 py-16 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
          <Sparkles className="h-5 w-5" />
        </div>
        <h3 className="mt-4 font-manrope text-lg font-semibold tracking-tight text-slate-900">
          Your canvas is quiet
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Ask Dreyv anything below, or open the capability palette to explore everything you can do.
        </p>
        <button
          onClick={onOpenPalette}
          className="mt-5 inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-50"
        >
          <Command className="h-3.5 w-3.5" />
          Open palette · ⌘K
        </button>
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
