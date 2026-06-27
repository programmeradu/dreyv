/**
 * Colosseum Copilot client.
 *
 * Thin wrapper around copilot.colosseum.com's search endpoint with a
 * 24h Postgres cache so we don't hammer the upstream from public Atlas
 * pages. Used by /api/atlas/colosseum/builders and the
 * <BuildersInThisSpace /> widget.
 *
 * Env:
 *   COLOSSEUM_COPILOT_API_BASE   default https://copilot.colosseum.com/api/v1
 *   COLOSSEUM_COPILOT_PAT        personal access token (Bearer)
 *
 * Docs: https://docs.colosseum.com/copilot
 */
import { neon } from "@neondatabase/serverless";

const DEFAULT_BASE = "https://copilot.colosseum.com/api/v1";
const DEFAULT_TTL_HOURS = 24;
const FETCH_TIMEOUT_MS = 8_000;

export interface ColosseumBuilder {
  /** Stable id from upstream when present, otherwise slug(name). */
  id: string;
  name: string;
  /** Short positioning line; truncated upstream descriptions are kept whole. */
  summary?: string;
  url?: string;
  /** Hackathon / track / cohort tags (raw). */
  tags?: string[];
  /** Upstream relevance score 0..1 when provided. */
  score?: number;
}

export interface BuildersResult {
  query: string;
  builders: ColosseumBuilder[];
  fetched_at: string;
  cached: boolean;
  source: string;
}

function normalizeKey(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function sqlClient() {
  const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, "").trim();
  if (!url) return null;
  return neon(url);
}

/**
 * Normalize a raw upstream Copilot search payload into the small shape the
 * UI consumes. We're defensive — Copilot's response surface evolves and we
 * don't want a schema drift to break the Atlas page.
 */
function normalize(raw: unknown): ColosseumBuilder[] {
  if (!raw || typeof raw !== "object") return [];
  const root = raw as Record<string, unknown>;
  const candidates: unknown[] =
    (Array.isArray(root.results) && root.results) ||
    (Array.isArray(root.builders) && root.builders) ||
    (Array.isArray(root.data) && root.data) ||
    (Array.isArray(root.hits) && root.hits) ||
    (Array.isArray(root.items) && root.items) ||
    [];

  const out: ColosseumBuilder[] = [];
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const name =
      (typeof r.name === "string" && r.name) ||
      (typeof r.title === "string" && r.title) ||
      (typeof r.project_name === "string" && r.project_name) ||
      "";
    if (!name) continue;

    const summary =
      (typeof r.summary === "string" && r.summary) ||
      (typeof r.description === "string" && r.description) ||
      (typeof r.tagline === "string" && r.tagline) ||
      undefined;

    const url =
      (typeof r.url === "string" && r.url) ||
      (typeof r.website === "string" && r.website) ||
      (typeof r.link === "string" && r.link) ||
      undefined;

    const tagsRaw = (Array.isArray(r.tags) && r.tags) || (Array.isArray(r.tracks) && r.tracks) || [];
    const tags = tagsRaw.filter((t): t is string => typeof t === "string");

    const score =
      typeof r.score === "number"
        ? r.score
        : typeof r.relevance === "number"
        ? r.relevance
        : undefined;

    const id =
      (typeof r.id === "string" && r.id) ||
      (typeof r.slug === "string" && r.slug) ||
      slugify(name);

    out.push({ id, name, summary, url, tags, score });
  }
  return out;
}

async function readCache(key: string): Promise<BuildersResult | null> {
  const sql = sqlClient();
  if (!sql) return null;
  try {
    const rows = (await sql/*sql*/`
      SELECT query, payload, source, fetched_at
        FROM public.colosseum_cache
       WHERE key = ${key} AND expires_at > now()
       LIMIT 1
    `) as Array<{ query: string; payload: unknown; source: string; fetched_at: Date | string }>;
    if (!rows.length) return null;
    const row = rows[0];
    const builders = Array.isArray(row.payload) ? (row.payload as ColosseumBuilder[]) : [];
    return {
      query: row.query,
      builders,
      fetched_at: new Date(row.fetched_at).toISOString(),
      cached: true,
      source: row.source,
    };
  } catch {
    return null;
  }
}

async function writeCache(key: string, query: string, builders: ColosseumBuilder[], ttlHours = DEFAULT_TTL_HOURS) {
  const sql = sqlClient();
  if (!sql) return;
  try {
    await sql/*sql*/`
      INSERT INTO public.colosseum_cache (key, query, payload, source, fetched_at, expires_at)
      VALUES (${key}, ${query}, ${JSON.stringify(builders)}::jsonb, 'copilot.search',
              now(), now() + (${ttlHours} || ' hours')::interval)
      ON CONFLICT (key) DO UPDATE
         SET payload    = EXCLUDED.payload,
             query      = EXCLUDED.query,
             fetched_at = EXCLUDED.fetched_at,
             expires_at = EXCLUDED.expires_at
    `;
  } catch {
    /* cache write is best-effort */
  }
}

async function callCopilot(query: string, limit: number): Promise<ColosseumBuilder[]> {
  const base = (process.env.COLOSSEUM_COPILOT_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  const pat = process.env.COLOSSEUM_COPILOT_PAT;
  if (!pat) throw new Error("COLOSSEUM_COPILOT_PAT not configured");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/json",
        "User-Agent": "dreyv-atlas/1.0 (+https://dreyv.com)",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`copilot ${res.status} ${res.statusText}`);
    }
    const raw = await res.json();
    return normalize(raw).slice(0, limit);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Public entry — returns cached builders when fresh, otherwise fetches
 * upstream and writes back to cache. Failures fall through to an empty
 * list so callers can render a graceful empty state.
 */
export async function getBuildersInSpace(
  query: string,
  opts: { limit?: number; ttlHours?: number; force?: boolean } = {},
): Promise<BuildersResult> {
  const q = query.trim();
  if (!q) return { query: q, builders: [], fetched_at: new Date().toISOString(), cached: false, source: "noop" };
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 20);
  const key = `${normalizeKey(q)}|${limit}`;

  if (!opts.force) {
    const hit = await readCache(key);
    if (hit) return hit;
  }

  const builders = await callCopilot(q, limit);
  await writeCache(key, q, builders, opts.ttlHours);
  return {
    query: q,
    builders,
    fetched_at: new Date().toISOString(),
    cached: false,
    source: "copilot.search",
  };
}

export function isColosseumConfigured(): boolean {
  return Boolean(process.env.COLOSSEUM_COPILOT_PAT);
}
