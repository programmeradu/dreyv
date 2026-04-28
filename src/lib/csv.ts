/**
 * Minimal CSV parser + file reader for treasury bulk uploads.
 *
 * Supports:
 *   - Comma OR tab delimited
 *   - Optional header row (auto-detected — first row treated as header
 *     if any cell is non-numeric and not a Solana-shaped address)
 *   - Quoted cells (double-quote escaped)
 *   - Skips blank lines and lines starting with `#`
 */

export interface ParsedCsv {
  headers: string[] | null;
  rows: string[][];
}

const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  let delim = line.includes("\t") && !line.includes(",") ? "\t" : ",";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) { out.push(cur.trim()); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

export function parseCsv(text: string): ParsedCsv {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) return { headers: null, rows: [] };
  const first = splitLine(lines[0]);
  const looksLikeHeader = first.some(
    (c) => c.length > 0 && Number.isNaN(Number(c)) && !SOLANA_ADDR.test(c),
  );
  const headers = looksLikeHeader ? first : null;
  const dataLines = looksLikeHeader ? lines.slice(1) : lines;
  return { headers, rows: dataLines.map(splitLine) };
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}
