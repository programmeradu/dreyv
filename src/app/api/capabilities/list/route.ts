/**
 * GET /api/capabilities/list — returns a typed summary of every capability in
 * the registry. Drives the Canvas Capability Palette (⌘K).
 *
 * Strips schemas + executors so the response stays small and serializable.
 */

import { NextResponse } from "next/server";
import { listCapabilities } from "@/lib/agents/capabilities/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const all = listCapabilities();
  const capabilities = all.map((c) => ({
    id: c.id,
    domain: c.domain,
    description: c.description,
    sideEffects: c.sideEffects,
    requiredAuth: c.requiredAuth,
    sensitivity: c.sensitivity,
    protocols: c.protocols ?? [],
  }));
  return NextResponse.json({ capabilities, count: capabilities.length });
}
