/**
 * Optional prop / set reference images for Veo 3.1.
 *
 * Veo caps `referenceImages` at 3 total, and the canonical Dreyv mascot
 * already uses all 3 slots on shot 1. To anchor devices and the set without
 * dropping the mascot entirely, we swap ONE mascot pose for a relevant prop
 * when the shot description calls for it (phone, laptop, desk).
 *
 * Drop additional real assets into `public/mascot/screens/` and add detector
 * rules below — e.g. real Dreyv UI screenshots (`dreyv-app-dashboard.png`,
 * `dreyv-app-atlas.png`) once the user provides them.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { VeoReferenceImage } from "@/lib/media-studio/mascot-references";

type PropRule = {
  /** Lowercased keywords that trigger this prop. */
  keywords: string[];
  /** File under project root. */
  file: string;
};

const PROP_RULES: PropRule[] = [
  // Devices — phone-in-hand wins over blank phone when a "holding" verb is present.
  { keywords: ["holding a phone", "phone in hand", "holds up", "swipes", "taps the phone", "scrolls"], file: "public/mascot/screens/device-phone-in-hand.png" },
  { keywords: ["phone", "smartphone", "mobile screen", "handset"], file: "public/mascot/screens/device-phone-blank.png" },
  { keywords: ["laptop", "macbook", "notebook computer", "desktop screen"], file: "public/mascot/screens/device-laptop-blank.png" },
  // Sets / environments
  { keywords: ["night", "evening", "late", "lamp", "dim"], file: "public/mascot/screens/set-desk-night.png" },
  { keywords: ["cafe", "coffee shop", "barista", "espresso"], file: "public/mascot/screens/set-cafe.png" },
  { keywords: ["rooftop", "skyline", "city view", "golden hour", "sunset terrace"], file: "public/mascot/screens/set-rooftop.png" },
  { keywords: ["desk", "workspace", "office", "studio room", "set"], file: "public/mascot/screens/set-desk-environment.png" },
];

const cache = new Map<string, VeoReferenceImage | null>();

async function loadProp(file: string): Promise<VeoReferenceImage | null> {
  if (cache.has(file)) return cache.get(file)!;
  try {
    const buf = await fs.readFile(path.join(process.cwd(), file));
    const ref: VeoReferenceImage = {
      image: { bytesBase64Encoded: buf.toString("base64"), mimeType: "image/png" },
      referenceType: "asset",
    };
    cache.set(file, ref);
    return ref;
  } catch {
    cache.set(file, null);
    return null;
  }
}

/**
 * Returns prop references implied by a shot description (lowercased keyword
 * match). Returns at most 2 — the mascot must keep at least 1 of the 3 Veo
 * reference slots so the character stays locked.
 */
export async function resolvePropRefsForShot(description: string): Promise<VeoReferenceImage[]> {
  const text = description.toLowerCase();
  const matched: VeoReferenceImage[] = [];
  const seen = new Set<string>();
  for (const rule of PROP_RULES) {
    if (matched.length >= 2) break;
    if (seen.has(rule.file)) continue;
    if (!rule.keywords.some((k) => text.includes(k))) continue;
    const ref = await loadProp(rule.file);
    if (ref) {
      matched.push(ref);
      seen.add(rule.file);
    }
  }
  return matched;
}
