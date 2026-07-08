"use client";

/**
 * Gates the "builder surface" (Studio, Marketplace, Library) in the app shell.
 *
 * Visible when ANY of:
 *   - `NEXT_PUBLIC_BUILDER_SURFACE_ENABLED === "true"` (global override)
 *   - current user is admin (passed in)
 *   - current user is a founding member (fetched from /api/billing/effective-tier)
 *
 * Hiding is reversible via env — routes stay live so nothing 404s.
 */

import { useEffect, useState } from "react";

const GLOBAL_ENABLED =
  (process.env.NEXT_PUBLIC_BUILDER_SURFACE_ENABLED ?? "").toLowerCase() === "true";

export function useBuilderSurfaceVisible(isAdmin: boolean): boolean {
  const [founding, setFounding] = useState(false);

  useEffect(() => {
    if (GLOBAL_ENABLED || isAdmin) return;
    let cancelled = false;
    fetch("/api/billing/effective-tier")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.founding) setFounding(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  return GLOBAL_ENABLED || isAdmin || founding;
}
