"use client";

/**
 * TokenAvatar — sophisticated placeholder for tokens without a logo.
 *
 * Renders the token's brand color (or a deterministic gradient) with a
 * monogram, a subtle conic ring, and an inner glossy highlight. Falls back
 * gracefully when the remote logo fails to load.
 */

import { useState } from "react";
import { getTokenColor } from "@/lib/token-colors";

interface TokenAvatarProps {
  symbol?: string;
  mint?: string;
  logo?: string;
  size?: number;
  className?: string;
}

/** Lighten/darken an HSL or hex-derived color by mixing with white/black. */
function deriveSecondary(hex: string): string {
  // For hsl() inputs, just shift hue
  if (hex.startsWith("hsl")) {
    return hex.replace(/hsl\((\d+)/, (_, h) => `hsl(${(parseInt(h) + 40) % 360}`);
  }
  // For hex, return a darker companion
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const dr = Math.max(0, Math.floor(r * 0.45));
  const dg = Math.max(0, Math.floor(g * 0.45));
  const db = Math.max(0, Math.floor(b * 0.55));
  return `rgb(${dr}, ${dg}, ${db})`;
}

function hashAngle(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
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
  const initial = (symbol || "?").slice(0, 2).toUpperCase();
  const primary = getTokenColor(seed);
  const secondary = deriveSecondary(primary);
  const angle = hashAngle(seed);

  const dim = { width: size, height: size };
  const fontSize = size <= 24 ? 9 : size <= 32 ? 11 : 13;

  if (showLogo) {
    return (
      <div
        style={dim}
        className={`relative rounded-full overflow-hidden border border-border bg-muted shadow-sm ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
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
      style={{
        ...dim,
        background: `linear-gradient(${angle}deg, ${primary} 0%, ${secondary} 100%)`,
      }}
      className={`relative rounded-full flex items-center justify-center overflow-hidden ring-1 ring-border shadow-sm ${className}`}
      aria-label={symbol || "Token"}
    >
      {/* Conic accent ring */}
      <div
        className="absolute inset-0 opacity-40 mix-blend-overlay"
        style={{
          background: `conic-gradient(from ${angle}deg, transparent 0deg, rgba(255,255,255,0.35) 90deg, transparent 180deg, rgba(0,0,0,0.2) 270deg, transparent 360deg)`,
        }}
      />
      {/* Glossy top highlight */}
      <div
        className="absolute inset-x-0 top-0 h-1/2 rounded-t-full opacity-50"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 100%)",
        }}
      />
      {/* Inner subtle border */}
      <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/15" />

      <span
        className="relative font-bold tracking-tight text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]"
        style={{ fontSize }}
      >
        {initial}
      </span>
    </div>
  );
}
