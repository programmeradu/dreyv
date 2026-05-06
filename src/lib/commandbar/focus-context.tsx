"use client";

/**
 * Phase E — CommandContext provider.
 *
 * Lets every page register what's currently on screen so the CommandBar agent
 * can reason about the user's focus ("user is on /app/treasury looking at
 * route X, viewing the Foresight panel"). The snapshot is injected as a
 * single CONTEXT line into the system prompt of `/api/command` on every turn.
 *
 * Usage from a page:
 *
 *   const setFocus = useSetCommandFocus();
 *   useEffect(() => {
 *     setFocus({
 *       scope: "treasury.routes",
 *       label: "Yield routes",
 *       data: { selectedRouteId, vault, count: routes.length },
 *     });
 *     return () => setFocus(null);
 *   }, [selectedRouteId, vault, routes.length]);
 *
 * Read from CommandBar via `useCommandFocus()` and forward in transport body.
 */

import * as React from "react";
import { usePathname } from "next/navigation";

export interface CommandFocus {
  /** Hierarchical scope, e.g. "treasury.routes", "analytics.foresight". */
  scope: string;
  /** Short human label, e.g. "Yield routes", "SOL concentration card". */
  label: string;
  /** Optional structured data — kept compact; do NOT dump entire datasets. */
  data?: Record<string, unknown>;
}

interface FocusState {
  pathname: string;
  focus: CommandFocus | null;
}

interface FocusContextShape {
  state: FocusState;
  setFocus: (next: CommandFocus | null) => void;
}

const Ctx = React.createContext<FocusContextShape | null>(null);

export function CommandFocusProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const [focus, setFocus] = React.useState<CommandFocus | null>(null);

  const value = React.useMemo<FocusContextShape>(
    () => ({ state: { pathname, focus }, setFocus }),
    [pathname, focus],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Read current focus snapshot. CommandBar uses this to attach to /api/command body. */
export function useCommandFocus(): FocusState {
  const ctx = React.useContext(Ctx);
  return ctx?.state ?? { pathname: typeof window !== "undefined" ? window.location.pathname : "/", focus: null };
}

/** Pages call this in a useEffect to declare what they're showing. */
export function useSetCommandFocus(): (next: CommandFocus | null) => void {
  const ctx = React.useContext(Ctx);
  return ctx?.setFocus ?? (() => {});
}

/** Convenience hook: declares + clears focus in one call. */
export function useDeclareFocus(focus: CommandFocus | null, deps: React.DependencyList = []) {
  const setFocus = useSetCommandFocus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    setFocus(focus);
    return () => setFocus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Server-side helper to format a focus snapshot into a one-line CONTEXT entry. */
export function formatFocusForLLM(snapshot: { pathname?: string; focus?: CommandFocus | null } | null | undefined): string | undefined {
  if (!snapshot) return undefined;
  const path = snapshot.pathname || "/";
  if (!snapshot.focus) {
    return `USER FOCUS: route=${path} (no on-screen scope registered)`;
  }
  const f = snapshot.focus;
  const dataStr = f.data ? ` data=${JSON.stringify(f.data).slice(0, 240)}` : "";
  return `USER FOCUS: route=${path} scope=${f.scope} label="${f.label}"${dataStr}`;
}
