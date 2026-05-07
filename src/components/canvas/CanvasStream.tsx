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
import { DreyvMascot } from "@/components/brand/dreyv-mascot";
import { DreyvStar } from "@/components/studio/DreyvStar";

export function CanvasStream({ scope }: { scope?: "dashboard" | "treasury" } = {}) {
  const { blocks: allBlocks, reorderBlocks } = useCanvas();
  const blocks = allBlocks.filter((b) => {
    if (!scope) return true;
    const origin = b.origin ?? "";
    if (scope === "treasury") return origin.startsWith("/app/treasury");
    return !origin.startsWith("/app/treasury") && !origin.startsWith("/app/analytics");
  });
  const pinned = blocks.filter((b) => b.pinned);
  const ephemeral = blocks.filter((b) => !b.pinned);

  if (blocks.length === 0) {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-violet-100 bg-white px-6 py-12 sm:py-16">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-violet-300/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 bottom-[-100px] h-64 w-64 rounded-full bg-violet-200/40 blur-3xl" />
        <div className="relative grid gap-6 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-600">
              <DreyvStar size={10} />
              <span>Your canvas</span>
            </div>
            <h3 className="mt-2 font-manrope text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              A quiet canvas, ready when you are.
            </h3>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-slate-600">
              Ask Dreyv anything below — every answer, plan, and insight will land here as a card you can pin, reorder, or dismiss.
            </p>
          </div>
          <div className="hidden sm:block">
            <DreyvMascot pose="greet" size={140} />
          </div>
        </div>
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
