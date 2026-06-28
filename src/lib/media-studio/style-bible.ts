/**
 * Single source of truth for Dreyv video generation style.
 *
 * Every prompt — draft generation AND per-shot Veo/Wan/Veo3 prompts —
 * imports from here so the mascot, palette, camera, and "clean cinematic"
 * rules stay locked across the entire pipeline.
 *
 * Why a separate file: previously the draft route described the mascot as
 * an "orange owl-fox with russet wing-tips" while the brand mascot is
 * SOLID violet `#7c3aed`. That single stale line is what made every render
 * come back as a brown/orange fox. Centralising it eliminates that drift.
 */

export const DREYV_MASCOT_DESCRIPTION =
  "Dreyv mascot: a calm, dignified owl treasury sentinel. " +
  "Body, wings, and ear tufts are SOLID violet (#7c3aed) with slightly deeper violet shading. " +
  "Cream-colored face, brow, and chest plumage. Large dark-violet eyes (not amber, not yellow). " +
  "Wears a SOLID violet ball cap stamped on the front with the Dreyv logo mark. " +
  "Cream chest is also stamped with the Dreyv logo mark. " +
  "The Dreyv logo mark is a rotated violet rounded-square glyph with an inner cutout — it is a symbol, NOT a letter, NEVER the letter 'D' or any other letter. " +
  "Flat illustration with clean vector lines and subtle cel-shaded depth — " +
  "Linear / Vercel / Stripe tier mascot quality. " +
  "Never orange, never brown, never red, never a realistic fox or owl, never gradients, never fuchsia or pink. " +
  "Same silhouette, proportions, palette, cap, and chest mark in every shot.";

export const DREYV_CINEMATIC_STYLE_BIBLE = [
  "Look and feel: cinematic, Pixar/Apple-keynote-grade clean. Disney-Pixar polish, not stock AI footage.",
  "Environment: a tangible premium product set — real desk, real laptop/phone, real wall, real surface, or real studio corner. Never a blank empty void unless the shot explicitly asks for a product-packshot.",
  "Palette lock: white / warm off-white base, solid violet #7c3aed accents only, deep slate for shadows. No fuchsia, no pink, no rainbow, no neon, no gradients across the frame.",
  "Camera: a steady cinema camera with intentional, slow, motivated motion (gentle dolly, push-in, orbit, over-shoulder, insert close-up, or parallax as required by the current shot). 35mm or 50mm equivalent depth of field. No drone swoops, no whip pans, no shaky cam, no morphing camera.",
  "Lighting: soft key light from upper-left, gentle ambient fill, one subtle violet practical accent. Consistent across all shots. No god rays, no lens flares, no bloom.",
  "Composition: rule of thirds, generous negative space, one clear story action per shot. The mascot must be DOING the shot action, not standing idle in the middle of an empty frame.",
  "Render quality: 4K cinematic, sharp focus on subject, smooth 24fps motion, photographic depth of field, no AI-watermark artefacts.",
].join(" ");

/**
 * The single most important rule for killing "obvious AI video" noise.
 *
 * Veo / Wan default to filling empty space with floating particles, glowing
 * orbs, abstract data shards, and morphing UI ribbons. Explicitly banning
 * them in every prompt is what gets us from "AI demo reel" to "Hollywood".
 */
export const DREYV_CLEAN_FRAME_RULES = [
  "STRICTLY CLEAN FRAME — no floating abstract elements, no drifting particles, no glowing orbs, no data shards, no light streaks, no holographic ribbons, no morphing geometric shapes, no swirling smoke, no chromatic aberration, no lens flares, no bloom, no glitch effects, no scan lines.",
  "No unreadable UI panels floating in space. No fake dashboard cards hovering mid-air. No procedural ribbons or noise overlays.",
  "If a UI is shown, render it as ONE single screen on a real device (laptop / phone) sitting in the scene, not as floating holograms.",
  "Backgrounds stay calm and physical — a real surface, a real wall, a real desk, a real studio corner. Never an abstract gradient void, never a blank empty mascot-on-white loop.",
  "Motion is purposeful and slow. No element moves unless the story requires it.",
].join(" ");

export const DREYV_TEXT_RULES =
  "Do NOT render any readable words, subtitles, captions, logo text, UI labels, numbers, brand names, or typography inside the video. " +
  "Real typography is composited separately in post — the model is famously bad at spelling. " +
  "If a screen must appear, show a real physical device with either a provided Dreyv screenshot reference or a clean non-readable interface made of simple neutral panels; no abstract violet blocks, floating widgets, fake holograms, or decorative geometry.";

export const DREYV_NEGATIVE_PROMPT = [
  // wrong mascot
  "orange fox", "brown fox", "red fox", "realistic fox", "cartoon fox in different color", "different mascot", "character redesign", "color drift", "fuchsia", "pink",
  // noise / "AI video" tells
  "standing idle", "blank background", "empty white void", "mascot standing still", "floating particles", "glowing orbs", "data shards", "holographic ribbons", "morphing shapes", "swirling smoke", "drifting glyphs", "abstract UI floating in midair", "fake dashboards hovering", "neon grid lines", "matrix code rain",
  "lens flare", "bloom", "chromatic aberration", "glitch", "scan lines", "film grain overlay", "rainbow gradient",
  // text quality
  "misspelled text", "garbled typography", "hallucinated logo text", "warped letters",
  // generic AI slop
  "extra fingers", "warped faces", "low quality", "watermark", "stock footage look", "uncanny valley",
].join(", ");

/** Compose the full style + mascot + cleanliness preamble used by shot prompts. */
export function dreyvShotStylePreamble(): string {
  return [
    `MASCOT LOCK — ${DREYV_MASCOT_DESCRIPTION}`,
    `STYLE BIBLE — ${DREYV_CINEMATIC_STYLE_BIBLE}`,
    `CLEAN FRAME — ${DREYV_CLEAN_FRAME_RULES}`,
    `TEXT RULE — ${DREYV_TEXT_RULES}`,
    `NEGATIVE PROMPT (do not include): ${DREYV_NEGATIVE_PROMPT}.`,
  ].join("\n");
}
