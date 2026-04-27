"use client";

/**
 * CanvasProvider — single source of truth for the dashboard's living stream.
 *
 * Mounted at /app/layout.tsx so every page under /app shares one canvas. The
 * BusBridge child translates legacy AppEventBus events into block additions,
 * which means existing emitters (CommandBar, AgentCommandCenter, agent route
 * handlers) populate the canvas with no call-site changes.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useKeystoneAuth } from "@/hooks/useKeystoneAuth";
import { loadPinned, savePinned } from "./persistence";
import type {
  CanvasBlock,
  CanvasContextValue,
} from "./types";
import { BusBridge } from "./bus-bridge";

const CanvasContext = createContext<CanvasContextValue | null>(null);

const MAX_BLOCKS = 80; // ephemeral blocks cap so the stream doesn't unbound.

function makeId(): string {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function CanvasProvider({ children }: { children: ReactNode }) {
  const { user } = useKeystoneAuth();
  const userId = user?.id ?? null;
  const [blocks, setBlocks] = useState<CanvasBlock[]>([]);
  const hydratedFor = useRef<string | null>(null);

  // Hydrate pinned blocks per user. Re-runs when the user changes (sign in/out).
  useEffect(() => {
    if (hydratedFor.current === userId) return;
    hydratedFor.current = userId;
    const pinned = loadPinned(userId);
    setBlocks((prev) => {
      // Keep ephemeral blocks already in memory, drop stale pinned, prepend fresh pinned.
      const ephemeral = prev.filter((b) => !b.pinned);
      const seen = new Set(pinned.map((p) => p.id));
      return [...pinned, ...ephemeral.filter((b) => !seen.has(b.id))];
    });
  }, [userId]);

  // Debounced persistence of pinned blocks.
  useEffect(() => {
    const t = window.setTimeout(() => savePinned(userId, blocks), 250);
    return () => window.clearTimeout(t);
  }, [userId, blocks]);

  const addBlock: CanvasContextValue["addBlock"] = useCallback((b) => {
    const id = b.id ?? makeId();
    setBlocks((prev) => {
      // De-dupe explicit ids so the same plan event firing twice doesn't double up.
      if (b.id && prev.some((x) => x.id === b.id)) return prev;
      const next: CanvasBlock = {
        id,
        createdAt: Date.now(),
        pinned: b.pinned ?? false,
        type: b.type,
        source: b.source,
        origin: b.origin,
        title: b.title,
        subtitle: b.subtitle,
        payload: b.payload,
      };
      // Newest non-pinned at top, just under the pinned section.
      const pinned = prev.filter((x) => x.pinned);
      const ephemeral = prev.filter((x) => !x.pinned);
      const merged = [...pinned, next, ...ephemeral];
      // Cap ephemeral length to keep the stream livable.
      if (merged.length > MAX_BLOCKS) {
        const trimmedEphemeral = merged.filter((x) => !x.pinned).slice(0, MAX_BLOCKS - pinned.length);
        return [...pinned, ...trimmedEphemeral];
      }
      return merged;
    });
    return id;
  }, []);

  const updateBlock: CanvasContextValue["updateBlock"] = useCallback((id, patch) => {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const { payload: payloadPatch, ...rest } = patch;
        return {
          ...b,
          ...rest,
          payload: payloadPatch ? { ...b.payload, ...payloadPatch } : b.payload,
        };
      }),
    );
  }, []);

  const removeBlock = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const pinBlock = useCallback((id: string, pinned?: boolean) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, pinned: pinned ?? !b.pinned } : b)),
    );
  }, []);

  const reorderBlocks = useCallback((ids: string[]) => {
    setBlocks((prev) => {
      const byId = new Map(prev.map((b) => [b.id, b]));
      const ordered = ids
        .map((id) => byId.get(id))
        .filter((b): b is CanvasBlock => Boolean(b));
      // Preserve any blocks that weren't in the reorder set (defensive).
      const orderedIds = new Set(ids);
      const leftovers = prev.filter((b) => !orderedIds.has(b.id));
      return [...ordered, ...leftovers];
    });
  }, []);

  const clearEphemeral = useCallback(() => {
    setBlocks((prev) => prev.filter((b) => b.pinned));
  }, []);

  const value = useMemo<CanvasContextValue>(
    () => ({ blocks, addBlock, updateBlock, removeBlock, pinBlock, reorderBlocks, clearEphemeral }),
    [blocks, addBlock, updateBlock, removeBlock, pinBlock, reorderBlocks, clearEphemeral],
  );

  return (
    <CanvasContext.Provider value={value}>
      <BusBridge />
      {children}
    </CanvasContext.Provider>
  );
}

export function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) {
    throw new Error("useCanvas must be used inside <CanvasProvider>.");
  }
  return ctx;
}

/** Safe variant for components that might render outside the provider. */
export function useOptionalCanvas(): CanvasContextValue | null {
  return useContext(CanvasContext);
}
