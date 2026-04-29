"use client";

/**
 * IR Binding Resolver
 * ───────────────────
 * Visuals reference real series by `bindingId`. The host page (analytics,
 * foresight panel) provides a resolver that maps ids → series points.
 *
 * This keeps the renderer pure (no fetching, no business logic) and means
 * "dynamic" UI is bound to truth, not LLM-imagined mocks.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { SeriesPointSchema } from "./ir";
import type { z } from "zod";

type Point = z.infer<typeof SeriesPointSchema>;

export type BindingResolver = (
  source: "snapshots" | "projection" | "events" | "composition" | "inline",
  bindingId?: string
) => Point[] | null;

const Ctx = createContext<BindingResolver>(() => null);

export function BindingProvider({
  resolver,
  children,
}: { resolver: BindingResolver; children: ReactNode }) {
  return <Ctx.Provider value={resolver}>{children}</Ctx.Provider>;
}

export function useBindingResolver(): BindingResolver {
  return useContext(Ctx);
}
