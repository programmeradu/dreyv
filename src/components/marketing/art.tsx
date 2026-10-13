/**
 * Still-life art for the marketing pages. All images are generated photographs
 * on warm cotton paper (Oct 2026), served as AVIF with a WebP fallback.
 * Files live in /public/art. Never stretch or outpaint: generate new art instead.
 */

export type ArtKey = "pricing" | "about" | "developers" | "compare" | "guides";

type ArtInfo = { alt: string; bg: string };

/** bg is sampled from the top edge of each photograph so the copy area blends into it. */
export const PAGE_ART: Record<ArtKey, ArtInfo> = {
  pricing: {
    alt: "Three short stacks of plain ivory and violet tokens on cotton paper in soft window light.",
    bg: "#cfc8b7",
  },
  about: {
    alt: "A violet notebook, a fountain pen and a cup on a desk, with shutter shadows from a window on the wall.",
    bg: "#e3dcd2",
  },
  developers: {
    alt: "A small coil of violet braided cable with a brass connector at its centre, on cotton paper.",
    bg: "#edece8",
  },
  compare: {
    alt: "Two folded ivory letters side by side on cotton paper, the right one crossed by a violet ribbon.",
    bg: "#eceae4",
  },
  guides: {
    alt: "An open book with blank ivory pages and a violet ribbon bookmark.",
    bg: "#dad5cc",
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
