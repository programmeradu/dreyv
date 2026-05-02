"use client";

import * as React from "react";
import { Download, Eye, Loader2, X } from "lucide-react";

/**
 * Triggers a real download of an image URL. R2 presigned GETs are short-lived
 * and cross-origin, so we fetch as a Blob and use an object URL — this avoids
 * the browser navigating to the image and ignoring `download=`.
 */
async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    // Fallback: open in a new tab so the user can save manually.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function safeFilename(name: string, fallback = "dreyv-image"): string {
  const base = (name || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || fallback}.png`;
}

/** Full-screen lightbox with a close button + download. */
export function ImageLightbox({
  url,
  alt,
  filename,
  onClose,
}: {
  url: string;
  alt: string;
  filename: string;
  onClose: () => void;
}) {
  const [downloading, setDownloading] = React.useState(false);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="relative max-h-full max-w-6xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          className="max-h-[88vh] w-auto max-w-full rounded-2xl object-contain shadow-2xl"
        />
        <div className="pointer-events-none absolute inset-x-0 -top-12 flex items-center justify-end gap-2 sm:-top-14">
          <button
            type="button"
            onClick={async () => {
              setDownloading(true);
              await downloadImage(url, filename);
              setDownloading(false);
            }}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-violet-700 shadow-lg hover:bg-violet-50"
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Download
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-violet-700 shadow-lg hover:bg-violet-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Floating View + Download buttons rendered over an image. Use inside a
 * `relative` parent. The parent should have `group` set if you want the
 * controls to fade in on hover (default behavior).
 */
export function ImageActions({
  url,
  alt,
  filename,
  onView,
  alwaysVisible = false,
}: {
  url: string;
  alt: string;
  filename: string;
  onView: () => void;
  alwaysVisible?: boolean;
}) {
  const [downloading, setDownloading] = React.useState(false);
  const visibility = alwaysVisible
    ? "opacity-100"
    : "opacity-0 transition group-hover:opacity-100 focus-within:opacity-100";

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    setDownloading(true);
    await downloadImage(url, filename);
    setDownloading(false);
  }

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-0 flex items-center justify-end gap-1.5 p-2 ${visibility}`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onView();
        }}
        aria-label={`View ${alt}`}
        className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-violet-700 shadow-md ring-1 ring-violet-200 hover:bg-white"
      >
        <Eye className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={handleDownload}
        aria-label={`Download ${alt}`}
        className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-violet-700 shadow-md ring-1 ring-violet-200 hover:bg-white disabled:opacity-60"
        disabled={downloading}
      >
        {downloading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

export { downloadImage, safeFilename };
