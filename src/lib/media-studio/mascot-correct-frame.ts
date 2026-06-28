/**
 * Mascot-correction pass for frame-perfect shot handoffs.
 *
 * Problem: Veo 3.1 rejects requests that set BOTH `image` (first-frame) and
 * `referenceImages` (mascot asset lock). If we hand off the raw last frame
 * of shot N to shot N+1, the mascot drifts shot-after-shot because Veo
 * extrapolates from a half-turned / blurred tail frame and forgets the
 * canonical violet body, cap, and chest mark.
 *
 * Solution: between shots, run a Gemini 2.5 Flash Image (nano-banana) edit
 * pass that takes (lastFrame + 3 canonical mascot refs) and repaints ONLY
 * the mascot back to canon — preserving the exact pose, camera angle,
 * framing, lighting, environment, and props. The corrected frame is then
 * fed to Veo as `firstFrameImage`, giving us both a frame-perfect cut AND a
 * canonical mascot every single shot.
 *
 * If the correction pass fails for any reason we fall back to the raw last
 * frame — a slightly drifted mascot is better than a broken pipeline.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { extractLastFramePng } from "@/lib/media-studio/extract-last-frame";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = "gemini-2.5-flash-image-preview";

const MASCOT_FILES = [
  "public/mascot/dreyv-greet.png",
  "public/mascot/dreyv-think.png",
  "public/mascot/dreyv-celebrate.png",
];

type InlinePng = { bytesBase64Encoded: string; mimeType: "image/png" };

let cachedRefs: Array<{ inlineData: { mimeType: string; data: string } }> | null = null;
let cachedAt = 0;
const REF_TTL_MS = 10 * 60 * 1000;

async function loadMascotRefPartsForGemini() {
  if (cachedRefs && Date.now() - cachedAt < REF_TTL_MS) return cachedRefs;
  const out: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  for (const rel of MASCOT_FILES) {
    try {
      const buf = await fs.readFile(path.join(process.cwd(), rel));
      out.push({ inlineData: { mimeType: "image/png", data: buf.toString("base64") } });
    } catch {
      // skip
    }
  }
  cachedRefs = out;
  cachedAt = Date.now();
  return out;
}

const CORRECTION_PROMPT = [
  "You are editing a single frame extracted from an animated commercial.",
  "Image 1 is the frame to edit. Images 2–4 are the CANONICAL reference for the Dreyv mascot.",
  "",
  "TASK: Repaint ONLY the mascot in image 1 so it exactly matches the canonical reference.",
  "- Body, wings, ear tufts: SOLID violet (#7c3aed) with subtly deeper violet shading.",
  "- Cream-colored face, brow, and chest plumage. Large dark-violet eyes (never amber/yellow).",
  "- Solid violet ball cap with the Dreyv rounded-square logo glyph stamped on the front.",
  "- Cream chest stamped with the same Dreyv rounded-square logo glyph.",
  "- The Dreyv mark is a symbol, NEVER the letter 'D' or any other letter.",
  "- Flat illustration with clean vector lines and subtle cel-shaded depth.",
  "",
  "PRESERVE EXACTLY (do not change):",
  "- The mascot's pose, gesture, head tilt, body orientation, and on-screen position.",
  "- Camera angle, framing, focal length, depth of field, and composition.",
  "- Lighting direction, color temperature, and shadows.",
  "- Environment, background, props, and any other characters or objects.",
  "- Aspect ratio and resolution.",
  "",
  "FORBIDDEN: orange/brown/red coloring, realistic fox or owl rendering, gradients, fuchsia, pink, added text, captions, watermarks, floating particles, glowing orbs, lens flares, style changes.",
  "",
  "Return the edited frame as a single PNG image. Do not return any text.",
].join("\n");

/**
 * Run the mascot-correction pass on a single PNG frame.
 * Returns a corrected PNG in the same VeoFirstFrameImage shape.
 */
async function correctMascotInFrame(frame: InlinePng): Promise<InlinePng | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  const refs = await loadMascotRefPartsForGemini();
  if (!refs.length) return null;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: CORRECTION_PROMPT },
          { inlineData: { mimeType: frame.mimeType, data: frame.bytesBase64Encoded } },
          ...refs,
        ],
      },
    ],
    generationConfig: {
      // Image-out modality is required for image edits on this model.
      responseModalities: ["IMAGE"],
      temperature: 0.2,
    },
  };

  const res = await fetch(
    `${GEMINI_BASE}/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.warn(`[mascot-correct] Gemini ${res.status}: ${txt.slice(0, 300)}`);
    return null;
  }
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  };
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const data = p.inlineData?.data;
    if (data && data.length > 200) {
      return { bytesBase64Encoded: data, mimeType: "image/png" };
    }
  }
  return null;
}

/**
 * Drop-in replacement for extractLastFramePng that also runs the mascot
 * correction pass. Falls back to the raw last frame if correction fails.
 */
export async function extractAndCorrectLastFrame(videoUrl: string): Promise<InlinePng> {
  const raw = await extractLastFramePng(videoUrl);
  try {
    const corrected = await correctMascotInFrame(raw);
    if (corrected) return corrected;
  } catch (err) {
    console.warn("[mascot-correct] correction failed, using raw last frame:", err);
  }
  return raw;
}
