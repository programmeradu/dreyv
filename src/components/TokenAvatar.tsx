"use client";

/**
 * TokenAvatar — generative geometric identicon for tokens without a logo.
 *
 * Each token gets a unique, deterministic "sigil": a composition of layered
 * geometric primitives (orbits, arcs, rays, dots) rendered in SVG. No letters,
 * no flat gradients — every token reads as its own little glyph.
 */

import { useMemo, useState } from "react";
import { getTokenColor } from "@/lib/token-colors";

interface TokenAvatarProps {
  symbol?: string;
  mint?: string;
  logo?: string;
  size?: number;
  className?: string;
}

/* -------- deterministic PRNG (mulberry32) -------- */
function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convert any color string to "r,g,b" for rgba() usage. */
function toRgbTriplet(color: string): string {
  if (color.startsWith("#")) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
  }
  if (color.startsWith("hsl")) {
    // crude hsl->rgb for alpha purposes; falls back to white-ish
    const m = color.match(/hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/);
    if (!m) return "255,255,255";
    const h = parseInt(m[1]) / 360;
    const s = parseInt(m[2]) / 100;
    const l = parseInt(m[3]) / 100;
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
    const g = Math.round(hue2rgb(p, q, h) * 255);
    const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
    return `${r}, ${g}, ${b}`;
  }
  return "255,255,255";
}

export function TokenAvatar({
  symbol,
  mint,
  logo,
  size = 32,
  className = "",
}: TokenAvatarProps) {
  const [errored, setErrored] = useState(false);
  const showLogo = logo && !errored;
  const seed = (symbol || mint || "T").toString();

  const sigil = useMemo(() => {
    const rand = mulberry32(hashSeed(seed));
    const primary = getTokenColor(seed);
    const rgb = toRgbTriplet(primary);

    // Compose 100x100 viewBox
    const cx = 50;
    const cy = 50;

    // Pick a "style" archetype deterministically
    const style = Math.floor(rand() * 4); // 0: orbits, 1: rays, 2: prism, 3: nodes

    const elements: React.ReactNode[] = [];

    // Backdrop: deep tinted disc with vignette
    elements.push(
      <circle key="bg" cx={cx} cy={cy} r={50} fill="#0b0d10" />,
      <circle
        key="bg-tint"
        cx={cx}
        cy={cy}
        r={50}
        fill={`rgba(${rgb}, 0.18)`}
      />,
      <circle
        key="bg-vignette"
        cx={cx}
        cy={cy}
        r={50}
        fill="url(#radial-fade)"
      />
    );

    if (style === 0) {
      // Orbits: concentric arcs at random rotations
      const rings = 3 + Math.floor(rand() * 2);
      for (let i = 0; i < rings; i++) {
        const r = 14 + i * 9;
        const rot = rand() * 360;
        const dash = 6 + rand() * 14;
        const gap = 4 + rand() * 10;
        elements.push(
          <circle
            key={`o-${i}`}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={`rgba(${rgb}, ${0.55 + i * 0.1})`}
            strokeWidth={1.4}
            strokeDasharray={`${dash} ${gap}`}
            transform={`rotate(${rot} ${cx} ${cy})`}
            strokeLinecap="round"
          />
        );
      }
      // Center bead
      elements.push(
        <circle key="bead" cx={cx} cy={cy} r={4} fill={`rgb(${rgb})`} />
      );
    } else if (style === 1) {
      // Rays: starburst from center
      const count = 6 + Math.floor(rand() * 6);
      const offset = rand() * 360;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * 360 + offset;
        const len = 18 + rand() * 22;
        const w = 1 + rand() * 1.6;
        elements.push(
          <line
            key={`r-${i}`}
            x1={cx}
            y1={cy}
            x2={cx + Math.cos((a * Math.PI) / 180) * len}
            y2={cy + Math.sin((a * Math.PI) / 180) * len}
            stroke={`rgba(${rgb}, ${0.5 + rand() * 0.4})`}
            strokeWidth={w}
            strokeLinecap="round"
          />
        );
      }
      elements.push(
        <circle
          key="halo"
          cx={cx}
          cy={cy}
          r={6}
          fill={`rgb(${rgb})`}
        />,
        <circle
          key="halo2"
          cx={cx}
          cy={cy}
          r={10}
          fill="none"
          stroke={`rgba(${rgb}, 0.6)`}
          strokeWidth={1.2}
        />
      );
    } else if (style === 2) {
      // Prism: rotating polygons stacked
      const layers = 3;
      const sides = 3 + Math.floor(rand() * 4); // 3..6
      for (let l = 0; l < layers; l++) {
        const r = 18 + l * 8;
        const rot = rand() * 360 + l * 17;
        const pts: string[] = [];
        for (let i = 0; i < sides; i++) {
          const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
          pts.push(`${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`);
        }
        elements.push(
          <polygon
            key={`p-${l}`}
            points={pts.join(" ")}
            fill="none"
            stroke={`rgba(${rgb}, ${0.45 + l * 0.15})`}
            strokeWidth={1.4}
            strokeLinejoin="round"
            transform={`rotate(${rot} ${cx} ${cy})`}
          />
        );
      }
      elements.push(
        <circle key="core" cx={cx} cy={cy} r={3.5} fill={`rgb(${rgb})`} />
      );
    } else {
      // Nodes: graph of dots connected by thin lines
      const count = 5 + Math.floor(rand() * 4);
      const nodes: { x: number; y: number }[] = [];
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rand() * 0.4;
        const r = 16 + rand() * 18;
        nodes.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      // Lines between sequential + center
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        elements.push(
          <line
            key={`nl-${i}`}
            x1={cx}
            y1={cy}
            x2={n.x}
            y2={n.y}
            stroke={`rgba(${rgb}, 0.5)`}
            strokeWidth={1}
          />
        );
        const next = nodes[(i + 1) % nodes.length];
        elements.push(
          <line
            key={`nl2-${i}`}
            x1={n.x}
            y1={n.y}
            x2={next.x}
            y2={next.y}
            stroke={`rgba(${rgb}, 0.3)`}
            strokeWidth={0.8}
          />
        );
      }
      nodes.forEach((n, i) =>
        elements.push(
          <circle
            key={`nd-${i}`}
            cx={n.x}
            cy={n.y}
            r={2.4}
            fill={`rgb(${rgb})`}
          />
        )
      );
      elements.push(
        <circle key="ncore" cx={cx} cy={cy} r={3.2} fill="#fff" opacity={0.9} />
      );
    }

    // Outer ring
    elements.push(
      <circle
        key="ring"
        cx={cx}
        cy={cy}
        r={48.5}
        fill="none"
        stroke={`rgba(${rgb}, 0.45)`}
        strokeWidth={1}
      />
    );

    return { elements, rgb };
  }, [seed]);

  if (showLogo) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`relative rounded-full overflow-hidden border border-border bg-muted shadow-sm ${className}`}
      >
        <img
          src={logo}
          alt={symbol || "Token"}
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
        />
      </div>
    );
  }

  return (
    <div
      style={{ width: size, height: size }}
      className={`relative rounded-full overflow-hidden ring-1 ring-border shadow-sm ${className}`}
      aria-label={symbol || "Token"}
      title={symbol}
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className="block"
      >
        <defs>
          <radialGradient id="radial-fade" cx="50%" cy="35%" r="65%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
            <stop offset="60%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.45)" />
          </radialGradient>
        </defs>
        {sigil.elements}
      </svg>
    </div>
  );
}
