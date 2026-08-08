/**
 * Canonical Dreyv mascot reference images, fed directly to Veo 3.1 as
 * `referenceImages` (referenceType: "asset") so the model copies the actual
 * design — violet body, cream chest with the Dreyv "D" mark, violet cap —
 * instead of inventing a mascot from a text description.
 *
 * Veo 3.1 accepts up to 3 asset reference images per generation.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export type VeoReferenceImage = {
  image: { bytesBase64Encoded: string; mimeType: string };
  referenceType: "asset";
};

// Three canonical poses → covers full body, three-quarter, and front views so
// Veo can reconstruct the mascot from any camera angle without drift.
const MASCOT_FILES = [
  "public/mascot/dreyv-greet.png",
  "public/mascot/dreyv-think.png",
  "public/mascot/dreyv-celebrate.png",
];

let cached: VeoReferenceImage[] | null = null;
let cachedAt = 0;
const TTL_MS = 10 * 60 * 1000;

export async function loadDreyvMascotReferences(): Promise<VeoReferenceImage[]> {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  const root = process.env.NEXT_RUNTIME === "edge" ? "." : (typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".");
  const out: VeoReferenceImage[] = [];
  for (const rel of MASCOT_FILES) {
    try {
      const buf = await fs.readFile(path.join(root, rel));
      out.push({
        image: { bytesBase64Encoded: buf.toString("base64"), mimeType: "image/png" },
        referenceType: "asset",
      });
    } catch {
      // Skip missing files — better to send fewer refs than to fail the render.
    }
  }
  cached = out;
  cachedAt = Date.now();
  return out;
}
