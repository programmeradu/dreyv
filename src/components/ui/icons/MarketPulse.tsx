import type { IconProps } from "./index";

export function IconMarketPulse({ className = "h-4 w-4", "aria-label": label }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-label={label}
      aria-hidden={!label}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* ECG / heart pulse line */}
      <path d="M3 12h4l2-5 3 10 2-7 2 4 1-2h4" />
    </svg>
  );
}
