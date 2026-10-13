/**
 * Still-life art for the marketing pages. All images are generated photographs
 * on warm cotton paper (Oct 2026), served as AVIF with a WebP fallback.
 * Files live in /public/art. Never stretch or outpaint: generate new art instead.
 */

export type ArtKey = "pricing" | "about" | "developers" | "compare" | "guides";

/** box: the still life inside the photo as fractions [left, top, right, bottom], so the hero can frame it without cropping. */
type ArtInfo = { alt: string; bg: string; box: [number, number, number, number] };

/** bg is sampled from the top edge of each photograph so the copy area blends into it. */
export const PAGE_ART: Record<ArtKey, ArtInfo> = {
  pricing: {
    alt: "Three short stacks of plain ivory and violet tokens on cotton paper in soft window light.",
    bg: "#cfc8b7",
    box: [0.33, 0.61, 0.68, 0.89],
  },
  about: {
    alt: "A violet notebook, a fountain pen and a cup on a desk, with shutter shadows from a window on the wall.",
    bg: "#e3dcd2",
    box: [0.49, 0.6, 0.92, 0.93],
  },
  developers: {
    alt: "A small coil of violet braided cable with a brass connector at its centre, on cotton paper.",
    bg: "#edece8",
    box: [0.4, 0.54, 0.6, 0.89],
  },
  compare: {
    alt: "Two folded ivory letters side by side on cotton paper, the right one crossed by a violet ribbon.",
    bg: "#eceae4",
    box: [0.24, 0.57, 0.75, 0.9],
  },
  guides: {
    alt: "An open book with blank ivory pages and a violet ribbon bookmark.",
    bg: "#dad5cc",
    box: [0.29, 0.6, 0.68, 0.98],
  },
};

const W = 1376;
const H = 768;

export function PageArtPicture({ art, priority = true }: { art: ArtKey; priority?: boolean }) {
  const base = `/art/hero-${art}`;
  return (
    <picture>
      <source type="image/avif" srcSet={`${base}-800.avif 800w, ${base}-1376.avif 1376w`} sizes="100vw" />
      <source type="image/webp" srcSet={`${base}-800.webp 800w, ${base}-1376.webp 1376w`} sizes="100vw" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${base}-1376.webp`}
        alt={PAGE_ART[art].alt}
        width={W}
        height={H}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        loading={priority ? "eager" : "lazy"}
      />
    </picture>
  );
}

/** Preload hint for a page hero (React 19 hoists it into <head>). */
export function PageArtPreload({ art }: { art: ArtKey }) {
  const base = `/art/hero-${art}`;
  return (
    <link
      rel="preload"
      as="image"
      type="image/avif"
      imageSrcSet={`${base}-800.avif 800w, ${base}-1376.avif 1376w`}
      imageSizes="100vw"
      fetchPriority="high"
    />
  );
}
