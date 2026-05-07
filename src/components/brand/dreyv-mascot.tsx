"use client";

import Image from "next/image";
import greet from "@/assets/mascot/dreyv-greet.png";
import think from "@/assets/mascot/dreyv-think.png";
import celebrate from "@/assets/mascot/dreyv-celebrate.png";
import alert from "@/assets/mascot/dreyv-alert.png";

const POSES = { greet, think, celebrate, alert } as const;
export type DreyvPose = keyof typeof POSES;

interface DreyvMascotProps {
  pose?: DreyvPose;
  size?: number;
  className?: string;
  glow?: boolean;
  priority?: boolean;
  alt?: string;
}

/**
 * Dreyv mascot — owl-fox treasury sentinel.
 * Transparent PNG, optional violet glow halo. Use sparingly at perfect moments.
 */
export function DreyvMascot({
  pose = "greet",
  size = 160,
  className = "",
  glow = true,
  priority = false,
  alt,
}: DreyvMascotProps) {
  const src = POSES[pose];
  return (
    <div
      className={`relative inline-block select-none ${className}`}
      style={{ width: size, height: size }}
      aria-hidden={alt ? undefined : true}
    >
      {glow && (
        <div
          className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-violet-400/25 blur-2xl"
        />
      )}
      <Image
        src={src}
        alt={alt ?? `Dreyv mascot — ${pose}`}
        width={size}
        height={size}
        priority={priority}
        className="h-full w-full object-contain drop-shadow-[0_18px_30px_rgba(124,58,237,0.28)]"
      />
    </div>
  );
}
