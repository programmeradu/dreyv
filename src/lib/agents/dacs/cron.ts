/**
 * DACS — minimal 5-field cron parser.
 *
 * Supports the standard subset we need for treasury directives:
 *   *           — wildcard
 *   N           — exact match
 *   N,M,...     — list
 *   A-B         — inclusive range
 *   * /N        — step  (e.g. */5 in minute = every 5 min)
 *   A-B/N       — range with step
 *
 * Fields (in order):
 *   minute (0-59)  hour (0-23)  dom (1-31)  month (1-12)  dow (0-6, Sun=0)
 *
 * Unsupported (intentionally — keep it small): named months/days, ?, L, W, #.
 *
 * `nextRunAfter(expr, from)` returns the next Date the cron should fire
 * strictly after `from` (UTC). Returns null when expression is invalid so
 * the caller can fall back to interval_seconds.
 */

type FieldSpec = Set<number>;

const FIELD_RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // dom
  [1, 12], // month
  [0, 6], // dow
];

function parseField(token: string, [min, max]: [number, number]): FieldSpec | null {
  const out = new Set<number>();
  const parts = token.split(",");
  for (const part of parts) {
    let step = 1;
    let body = part;
    const slashIdx = part.indexOf("/");
    if (slashIdx >= 0) {
      step = Number(part.slice(slashIdx + 1));
      body = part.slice(0, slashIdx);
      if (!Number.isFinite(step) || step <= 0) return null;
    }
    let lo: number;
    let hi: number;
    if (body === "*" || body === "") {
      lo = min;
      hi = max;
    } else if (body.includes("-")) {
      const [a, b] = body.split("-").map(Number);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      lo = a;
      hi = b;
    } else {
      const n = Number(body);
      if (!Number.isFinite(n)) return null;
      lo = n;
      hi = n;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let i = lo; i <= hi; i += step) out.add(i);
  }
  return out;
}

interface ParsedCron {
  minute: FieldSpec;
  hour: FieldSpec;
  dom: FieldSpec;
  month: FieldSpec;
  dow: FieldSpec;
  /** True when both dom and dow are restricted — match either (Vixie cron). */
  domDowOr: boolean;
}

export function parseCron(expr: string): ParsedCron | null {
  if (!expr || typeof expr !== "string") return null;
  const tokens = expr.trim().split(/\s+/);
  if (tokens.length !== 5) return null;
  const fields: FieldSpec[] = [];
  for (let i = 0; i < 5; i++) {
    const f = parseField(tokens[i], FIELD_RANGES[i]);
    if (!f) return null;
    fields.push(f);
  }
  const [minute, hour, dom, month, dow] = fields;
  // Vixie-cron rule: when both dom and dow are restricted (not "*"), match
  // when EITHER fires.
  const domRestricted = tokens[2] !== "*";
  const dowRestricted = tokens[4] !== "*";
  return { minute, hour, dom, month, dow, domDowOr: domRestricted && dowRestricted };
}

export function nextRunAfter(expr: string, from: Date = new Date()): Date | null {
  const p = parseCron(expr);
  if (!p) return null;

  // Start at from + 1 minute, zero seconds — cron fires at minute boundaries.
  const d = new Date(from.getTime());
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);

  // Hard upper bound: 4 years out — protects against impossible expressions.
  const limit = new Date(from.getTime() + 4 * 366 * 86_400_000);

  while (d < limit) {
    if (!p.month.has(d.getUTCMonth() + 1)) {
      // Jump to first of next month at 00:00.
      d.setUTCDate(1);
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCMonth(d.getUTCMonth() + 1);
      continue;
    }
    const domOk = p.dom.has(d.getUTCDate());
    const dowOk = p.dow.has(d.getUTCDay());
    const dayOk = p.domDowOr ? domOk || dowOk : domOk && dowOk;
    if (!dayOk) {
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() + 1);
      continue;
    }
    if (!p.hour.has(d.getUTCHours())) {
      d.setUTCMinutes(0, 0, 0);
      d.setUTCHours(d.getUTCHours() + 1);
      continue;
    }
    if (!p.minute.has(d.getUTCMinutes())) {
      d.setUTCSeconds(0, 0);
      d.setUTCMinutes(d.getUTCMinutes() + 1);
      continue;
    }
    return d;
  }
  return null;
}
