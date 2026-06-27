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

// ───────────────────────── project + similar ─────────────────────────

export interface ColosseumProject extends ColosseumBuilder {
  /** Hackathon track name (e.g. "Renaissance — DeFi"). */
  hackathon?: string;
  /** Cohort / batch when surfaced upstream. */
  cohort?: string;
  /** Founders / team members. */
  team?: Array<{ name: string; role?: string; url?: string }>;
  /** Funding / accelerator status. */
  funding?: { stage?: string; amountUsd?: number; investors?: string[] };
  /** Social / external links. */
  links?: { website?: string; twitter?: string; github?: string; demo?: string };
  /** Raw upstream payload retained for clients that want more fields. */
  raw?: Record<string, unknown>;
}

export interface ProjectResult {
  slug: string;
  project: ColosseumProject | null;
  fetched_at: string;
  cached: boolean;
  source: string;
}

export interface SimilarResult {
  slug: string;
  similar: ColosseumBuilder[];
  fetched_at: string;
  cached: boolean;
  source: string;
}

function normalizeProject(raw: unknown): ColosseumProject | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as Record<string, unknown>;
  const node =
    (root.project && typeof root.project === "object" && (root.project as Record<string, unknown>)) ||
    (root.data && typeof root.data === "object" && (root.data as Record<string, unknown>)) ||
    (root.result && typeof root.result === "object" && (root.result as Record<string, unknown>)) ||
    root;
  const base = normalize({ results: [node] })[0];
  if (!base) return null;
  const r = node as Record<string, unknown>;

  const teamRaw = (Array.isArray(r.team) && r.team) || (Array.isArray(r.founders) && r.founders) || [];
  const team = teamRaw
    .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
    .map((m) => ({
      name: (typeof m.name === "string" && m.name) || (typeof m.full_name === "string" && m.full_name) || "",
      role: typeof m.role === "string" ? m.role : typeof m.title === "string" ? m.title : undefined,
      url: typeof m.url === "string" ? m.url : typeof m.twitter === "string" ? m.twitter : undefined,
    }))
    .filter((m) => m.name);

  const links: ColosseumProject["links"] = {};
  if (typeof r.website === "string") links.website = r.website;
  if (typeof r.twitter === "string") links.twitter = r.twitter;
  if (typeof r.github === "string") links.github = r.github;
  if (typeof r.demo === "string") links.demo = r.demo;

  const funding: ColosseumProject["funding"] = {};
  if (typeof r.funding_stage === "string") funding.stage = r.funding_stage;
  if (typeof r.funding_amount_usd === "number") funding.amountUsd = r.funding_amount_usd;
  if (Array.isArray(r.investors)) {
    funding.investors = r.investors.filter((x): x is string => typeof x === "string");
  }

  return {
    ...base,
    hackathon: typeof r.hackathon === "string" ? r.hackathon : typeof r.track === "string" ? r.track : undefined,
    cohort: typeof r.cohort === "string" ? r.cohort : typeof r.batch === "string" ? r.batch : undefined,
    team: team.length ? team : undefined,
    funding: Object.keys(funding).length ? funding : undefined,
    links: Object.keys(links).length ? links : undefined,
    raw: node,
  };
}

async function readCacheRaw<T>(key: string): Promise<{ payload: T; source: string; fetched_at: string } | null> {
  const sql = sqlClient();
  if (!sql) return null;
  try {
    const rows = (await sql/*sql*/`
      SELECT payload, source, fetched_at
        FROM public.colosseum_cache
       WHERE key = ${key} AND expires_at > now()
       LIMIT 1
    `) as Array<{ payload: T; source: string; fetched_at: Date | string }>;
    if (!rows.length) return null;
    return {
      payload: rows[0].payload,
      source: rows[0].source,
      fetched_at: new Date(rows[0].fetched_at).toISOString(),
    };
  } catch {
    return null;
  }
}

async function writeCacheRaw(key: string, query: string, payload: unknown, source: string, ttlHours = DEFAULT_TTL_HOURS) {
  const sql = sqlClient();
  if (!sql) return;
  try {
    await sql/*sql*/`
      INSERT INTO public.colosseum_cache (key, query, payload, source, fetched_at, expires_at)
      VALUES (${key}, ${query}, ${JSON.stringify(payload)}::jsonb, ${source},
              now(), now() + (${ttlHours} || ' hours')::interval)
      ON CONFLICT (key) DO UPDATE
         SET payload    = EXCLUDED.payload,
             query      = EXCLUDED.query,
             source     = EXCLUDED.source,
             fetched_at = EXCLUDED.fetched_at,
             expires_at = EXCLUDED.expires_at
    `;
  } catch {
    /* best-effort */
  }
}

async function copilotGet(path: string): Promise<unknown> {
  const base = (process.env.COLOSSEUM_COPILOT_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  const pat = process.env.COLOSSEUM_COPILOT_PAT;
  if (!pat) throw new Error("COLOSSEUM_COPILOT_PAT not configured");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/json",
        "User-Agent": "dreyv-atlas/1.0 (+https://dreyv.com)",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`copilot ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Full project profile. Tries `/projects/{slug}` first; falls back to a
 * top-hit search so the widget always has something to render.
 */
export async function getColosseumProject(
  slug: string,
  opts: { ttlHours?: number; force?: boolean } = {},
): Promise<ProjectResult> {
  const s = slug.trim();
  if (!s) {
    return { slug: s, project: null, fetched_at: new Date().toISOString(), cached: false, source: "noop" };
  }
  const key = `project|${normalizeKey(s)}`;

  if (!opts.force) {
    const hit = await readCacheRaw<ColosseumProject | null>(key);
    if (hit) {
      return {
        slug: s,
        project: hit.payload ?? null,
        fetched_at: hit.fetched_at,
        cached: true,
        source: hit.source,
      };
    }
  }

  let project: ColosseumProject | null = null;
  let source = "copilot.project";
  try {
    const raw = await copilotGet(`/projects/${encodeURIComponent(slugify(s))}`);
    project = normalizeProject(raw);
  } catch {
    try {
      const raw = await copilotGet(`/search?q=${encodeURIComponent(s)}&limit=1`);
      const builders = normalize(raw);
      project = builders[0]
        ? { ...builders[0], raw: (builders[0] as unknown) as Record<string, unknown> }
        : null;
      source = "copilot.search";
    } catch {
      project = null;
      source = "copilot.error";
    }
  }

  await writeCacheRaw(key, s, project, source, opts.ttlHours);
  return {
    slug: s,
    project,
    fetched_at: new Date().toISOString(),
    cached: false,
    source,
  };
}

/**
 * Projects similar to `slug`. Tries `/projects/{slug}/similar` first,
 * falls back to a `like:` search query.
 */
export async function getSimilarProjects(
  slug: string,
  opts: { limit?: number; ttlHours?: number; force?: boolean } = {},
): Promise<SimilarResult> {
  const s = slug.trim();
  const limit = Math.min(Math.max(opts.limit ?? 6, 1), 20);
  if (!s) {
    return { slug: s, similar: [], fetched_at: new Date().toISOString(), cached: false, source: "noop" };
  }
  const key = `similar|${normalizeKey(s)}|${limit}`;

  if (!opts.force) {
    const hit = await readCacheRaw<ColosseumBuilder[]>(key);
    if (hit) {
      return {
        slug: s,
        similar: Array.isArray(hit.payload) ? hit.payload : [],
        fetched_at: hit.fetched_at,
        cached: true,
        source: hit.source,
      };
    }
  }

  let similar: ColosseumBuilder[] = [];
  let source = "copilot.similar";
  try {
    const raw = await copilotGet(`/projects/${encodeURIComponent(slugify(s))}/similar?limit=${limit}`);
    similar = normalize(raw);
  } catch {
    try {
      const raw = await copilotGet(`/search?q=${encodeURIComponent(`like:${s}`)}&limit=${limit}`);
      similar = normalize(raw).filter((b) => b.id !== slugify(s)).slice(0, limit);
      source = "copilot.search";
    } catch {
      similar = [];
      source = "copilot.error";
    }
  }

  await writeCacheRaw(key, s, similar, source, opts.ttlHours);
  return {
    slug: s,
    similar,
    fetched_at: new Date().toISOString(),
    cached: false,
    source,
  };
}
