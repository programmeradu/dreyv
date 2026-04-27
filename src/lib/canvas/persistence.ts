/**
 * Per-user persistence for the Canvas. Pinned blocks only — ephemeral blocks
 * vanish on reload by design (the canvas is a living surface, not a log).
 */

import type { CanvasBlock } from "./types";

const VERSION = "v1";

export function storageKey(userId: string | null | undefined): string {
  return `dreyv:canvas:${VERSION}:${userId ?? "anon"}`;
}

export function loadPinned(userId: string | null | undefined): CanvasBlock[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((b: unknown): b is CanvasBlock => {
      if (!b || typeof b !== "object") return false;
      const x = b as Record<string, unknown>;
      return typeof x.id === "string" && typeof x.type === "string" && x.pinned === true;
    });
  } catch {
    return [];
  }
}

export function savePinned(
  userId: string | null | undefined,
  blocks: CanvasBlock[],
): void {
  if (typeof window === "undefined") return;
  try {
    const pinned = blocks.filter((b) => b.pinned);
    window.localStorage.setItem(storageKey(userId), JSON.stringify(pinned));
  } catch {
    // quota / disabled storage — ignore, canvas still works in-memory.
  }
}
