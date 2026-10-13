import localFont from "next/font/local";

/** Newsreader (variable wght + opsz), latin subset. Display serif approved for dreyv (Oct 2026). */
export const newsreader = localFont({
  src: [{ path: "./fonts/newsreader-var.woff2", weight: "200 800", style: "normal" }],
  variable: "--mk-serif",
  display: "swap",
  preload: true,
  fallback: ["Georgia", "Times New Roman", "serif"],
});

/** Inter (variable wght + opsz), latin subset. Body and UI text. */
export const inter = localFont({
  src: [{ path: "./fonts/inter-var.woff2", weight: "100 900", style: "normal" }],
  variable: "--mk-sans",
  display: "swap",
  preload: true,
  fallback: ["system-ui", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
});
