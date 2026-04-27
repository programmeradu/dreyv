/**
 * Token registry store — persistent learning loop for resolved tokens.
 *
 * Backed by `knowledgeEntries` so resolved mints survive cold starts and are
 * shared across users and routes. Layered cache:
 *
 *   memory cache (per process)  →  knowledgeEntries (per workspace)  →  network
 *
 * Every successful Jupiter / on-chain resolution is written back so the next
 * request anywhere in the app skips the network entirely. Safety reports are
 * persisted with a TTL since mint/freeze authorities can change over time.
 */

import { db } from "@/db";
import { knowledgeEntries } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { ResolvedToken, TokenSafetyReport } from "./token-resolver";

const SOURCE_TOKEN = "token-registry";
const SOURCE_SAFETY = "token-safety";
const SAFETY_TTL_MS = 24 * 60 * 60 * 1000; // re-check authorities once a day

// ── Token metadata (resolved symbol → mint) ────────────────────────────────

export async function loadResolvedToken(key: string): Promise<ResolvedToken | null> {
  if (!db) return null;
  try {
    const tag = key.toUpperCase();
    const rows = await db
      .select()
      .from(knowledgeEntries)
      .where(
        and(
          eq(knowledgeEntries.source, SOURCE_TOKEN),
          // Match by mint address OR symbol via tags array.
          sql`${knowledgeEntries.tags} @> ARRAY[${tag}]::text[]`,
        ),
      )
      .limit(1);
    if (rows.length === 0) return null;
    const r = rows[0] as { content: string | null };
    if (!r.content) return null;
    return JSON.parse(r.content) as ResolvedToken;
  } catch (err) {
    console.warn("[token-registry] loadResolvedToken failed:", err);
    return null;
  }
}

export async function saveResolvedToken(token: ResolvedToken): Promise<void> {
  if (!db) return;
  try {
    // Idempotent: skip if mint already stored.
    const existing = await db
      .select({ id: knowledgeEntries.id })
      .from(knowledgeEntries)
      .where(
        and(
          eq(knowledgeEntries.source, SOURCE_TOKEN),
          sql`${knowledgeEntries.tags} @> ARRAY[${token.mint}]::text[]`,
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    await db.insert(knowledgeEntries).values({
      source: SOURCE_TOKEN,
      title: `${token.symbol} — ${token.name ?? token.mint.slice(0, 8)}`,
      summary: `Resolved via ${token.source}${token.verified ? " (verified)" : ""}`,
      content: JSON.stringify(token),
      contentType: "application/json",
      tags: [token.mint, token.symbol.toUpperCase(), "token-registry"],
      userId: null, // global/shared knowledge
    });
    console.log(`[token-registry] cached ${token.symbol} (${token.mint.slice(0, 8)}…)`);
  } catch (err) {
    console.warn("[token-registry] saveResolvedToken failed:", err);
  }
}

// ── Safety reports (mint → risk band + warnings) ───────────────────────────

interface PersistedSafety {
  report: TokenSafetyReport;
  storedAt: number;
}

export async function loadSafetyReport(mint: string): Promise<TokenSafetyReport | null> {
  if (!db) return null;
  try {
    const rows = await db
      .select()
      .from(knowledgeEntries)
      .where(
        and(
          eq(knowledgeEntries.source, SOURCE_SAFETY),
          sql`${knowledgeEntries.tags} @> ARRAY[${mint}]::text[]`,
        ),
      )
      .limit(1);
    if (rows.length === 0) return null;
    const r = rows[0] as { content: string | null };
    if (!r.content) return null;
    const parsed = JSON.parse(r.content) as PersistedSafety;
    if (Date.now() - parsed.storedAt > SAFETY_TTL_MS) return null;
    return parsed.report;
  } catch (err) {
    console.warn("[token-registry] loadSafetyReport failed:", err);
    return null;
  }
}

export async function saveSafetyReport(report: TokenSafetyReport): Promise<void> {
  if (!db) return;
  try {
    // Replace any prior report for this mint to keep the registry fresh.
    await db
      .delete(knowledgeEntries)
      .where(
        and(
          eq(knowledgeEntries.source, SOURCE_SAFETY),
          sql`${knowledgeEntries.tags} @> ARRAY[${report.mint}]::text[]`,
        ),
      );

    const payload: PersistedSafety = { report, storedAt: Date.now() };
    await db.insert(knowledgeEntries).values({
      source: SOURCE_SAFETY,
      title: `Safety: ${report.mint.slice(0, 8)}… — ${report.band}`,
      summary: report.warnings.join(" | ") || "no warnings",
      content: JSON.stringify(payload),
      contentType: "application/json",
      tags: [report.mint, `band:${report.band}`, "token-safety"],
      expiresAt: new Date(Date.now() + SAFETY_TTL_MS),
      userId: null,
    });
    console.log(`[token-registry] cached safety ${report.mint.slice(0, 8)}… → ${report.band}`);
  } catch (err) {
    console.warn("[token-registry] saveSafetyReport failed:", err);
  }
}
