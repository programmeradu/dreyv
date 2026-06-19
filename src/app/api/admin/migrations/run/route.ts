import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOTS = ["db-migrations", "migrations/sql"];

function authorized(req: NextRequest): boolean {
  const key = req.headers.get("x-admin-key");
  const expected = process.env.JWT_SECRET;
  return !!expected && key === expected;
}

async function listFiles() {
  const out: { root: string; file: string; path: string; bytes: number }[] = [];
  for (const root of ROOTS) {
    const abs = path.join(process.cwd(), root);
    let entries: string[] = [];
    try {
      entries = await readdir(abs);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith(".sql")) continue;
      const buf = await readFile(path.join(abs, f));
      out.push({ root, file: f, path: `${root}/${f}`, bytes: buf.byteLength });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Split a SQL script into individual statements while respecting
 * single-quoted strings, double-quoted identifiers, line comments,
 * block comments, and dollar-quoted blocks ($$ ... $$ or $tag$ ... $tag$).
 */
function splitStatements(sql: string): string[] {
  const stmts: string[] = [];
  let buf = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    // line comment
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const slice = end === -1 ? sql.slice(i) : sql.slice(i, end + 1);
      buf += slice;
      i += slice.length;
      continue;
    }
    // block comment
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      const slice = end === -1 ? sql.slice(i) : sql.slice(i, end + 2);
      buf += slice;
      i += slice.length;
      continue;
    }
    // single-quoted string
    if (ch === "'") {
      buf += ch;
      i++;
      while (i < n) {
        buf += sql[i];
        if (sql[i] === "'" && sql[i + 1] !== "'") {
          i++;
          break;
        }
        if (sql[i] === "'" && sql[i + 1] === "'") {
          buf += sql[i + 1];
          i += 2;
          continue;
        }
        i++;
      }
      continue;
    }
    // double-quoted identifier
    if (ch === '"') {
      buf += ch;
      i++;
      while (i < n) {
        buf += sql[i];
        if (sql[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // dollar-quoted
    if (ch === "$") {
      const m = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m) {
        const tag = m[0];
        buf += tag;
        i += tag.length;
        const end = sql.indexOf(tag, i);
        if (end === -1) {
          buf += sql.slice(i);
          i = n;
        } else {
          buf += sql.slice(i, end + tag.length);
          i = end + tag.length;
        }
        continue;
      }
    }
    if (ch === ";") {
      const trimmed = buf.trim();
      if (trimmed) stmts.push(trimmed);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  const tail = buf.trim();
  if (tail) stmts.push(tail);
  return stmts;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const files = await listFiles();
  return NextResponse.json({ files });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    file?: string;
    sql?: string;
    stopOnError?: boolean;
  };

  const stopOnError = body.stopOnError !== false;

  let source = "";
  let label = "inline";
  if (body.file) {
    const rel = body.file.replace(/^\/+/, "");
    if (!ROOTS.some((r) => rel.startsWith(`${r}/`))) {
      return NextResponse.json(
        { error: "file must live under db-migrations/ or migrations/sql/" },
        { status: 400 },
      );
    }
    if (rel.includes("..")) {
      return NextResponse.json({ error: "invalid path" }, { status: 400 });
    }
    if (!rel.endsWith(".sql")) {
      return NextResponse.json({ error: "only .sql files" }, { status: 400 });
    }
    try {
      source = await readFile(path.join(process.cwd(), rel), "utf8");
      label = rel;
    } catch (err) {
      return NextResponse.json(
        { error: `cannot read ${rel}: ${(err as Error).message}` },
        { status: 404 },
      );
    }
  } else if (body.sql) {
    source = body.sql;
  } else {
    return NextResponse.json(
      { error: "provide { file } or { sql }" },
      { status: 400 },
    );
  }

  const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, "").trim();
  if (!url) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured" },
      { status: 500 },
    );
  }

  const sql = neon(url);
  const statements = splitStatements(source);
  const results: {
    index: number;
    preview: string;
    ok: boolean;
    error?: string;
    ms: number;
  }[] = [];

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.replace(/\s+/g, " ").slice(0, 140);
    const t0 = Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (sql as any).query(stmt);
      results.push({ index: i, preview, ok: true, ms: Date.now() - t0 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        index: i,
        preview,
        ok: false,
        error: message,
        ms: Date.now() - t0,
      });
      if (stopOnError) break;
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;

  return NextResponse.json({
    ok: failCount === 0,
    label,
    total: statements.length,
    executed: results.length,
    okCount,
    failCount,
    results,
  });
}
