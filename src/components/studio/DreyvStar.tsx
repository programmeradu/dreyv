"use client";

/**
 * DreyvStar — the 4-pointed brand star used across Studio chrome
 * to replace generic AI/Sparkles iconography in headers.
 *
 * Pure SVG (no asset dependency) so it stays crisp at any size and
 * inherits color via `currentColor`.
 */
interface DreyvStarProps {
    className?: string;
    size?: number;
    strokeWidth?: number;
}

export function DreyvStar({ className, size = 16, strokeWidth = 0 }: DreyvStarProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width={size}
            height={size}
            className={className}
            aria-hidden="true"
            focusable="false"
        >
            {/* Sharp 4-point star (concave diamond) */}
            <path
                d="M12 1.5 L14.2 9.8 L22.5 12 L14.2 14.2 L12 22.5 L9.8 14.2 L1.5 12 L9.8 9.8 Z"
                fill="currentColor"
                stroke={strokeWidth ? "currentColor" : "none"}
                strokeWidth={strokeWidth}
                strokeLinejoin="round"
            />
        </svg>
    );
}
