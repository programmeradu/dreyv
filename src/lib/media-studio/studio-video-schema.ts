import { db } from "@/db";
import { sql } from "drizzle-orm";

export function rowsFromResult(result: unknown): Array<Record<string, unknown>> {
  return (
    (result as { rows?: Array<Record<string, unknown>> }).rows ??
    (Array.isArray(result) ? (result as Array<Record<string, unknown>>) : [])
  );
}

let r2ColumnCheck: { value: boolean; checkedAt: number } | null = null;
const R2_COLUMN_CHECK_TTL_MS = 60_000;

export async function studioVideoR2ColumnsAvailable(): Promise<boolean> {
  if (!db) return false;

  const now = Date.now();
  if (r2ColumnCheck && now - r2ColumnCheck.checkedAt < R2_COLUMN_CHECK_TTL_MS) {
    return r2ColumnCheck.value;
  }

  try {
    const result = (await db.execute(sql`
      SELECT COUNT(*)::int AS found
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'studio_video_jobs'
        AND column_name IN ('shot_keys', 'final_key')
    `)) as unknown;
    const found = Number(rowsFromResult(result)[0]?.found ?? 0);
    const value = found === 2;
    r2ColumnCheck = { value, checkedAt: now };
    return value;
  } catch (err) {
    console.warn("[studio/video] R2 column capability check failed:", err);
    r2ColumnCheck = { value: false, checkedAt: now };
    return false;
  }
}