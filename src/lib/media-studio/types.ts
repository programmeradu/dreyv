/**
 * Shared TS types for the Media Studio. Mirrors the JSON-schema contracts
 * that the API routes return so the UI can stay typed end-to-end.
 */

export type Channel = "x" | "linkedin" | "instagram" | "generic";
export type AssetKind = "post" | "infographic" | "announcement" | "video";

export type CopyVariant = { headline?: string; body: string; cta?: string };

export type CopyResult = {
  variants: CopyVariant[];
  altText: string;
  suggestedHashtags: string[];
};

export type InfographicSpec = {
  title: string;
  subtitle?: string;
  heroStat?: { value: string; label: string };
  bullets: Array<{ label: string; value?: string; detail?: string }>;
  footnote?: string;
  layout: "stat-hero" | "three-pillars" | "comparison" | "timeline";
};

export type VideoStoryboard = {
  title: string;
  durationSeconds: number;
  aspect: "9:16" | "1:1" | "16:9";
  scenes: Array<{
    timeRange: string;
    visual: string;
    voiceover?: string;
    onScreenText?: string;
  }>;
  hookLine: string;
  closingCta: string;
  music?: string;
};

export type MediaAsset = {
  id: string;
  userId: string | null;
  kind: AssetKind;
  channel: Channel | null;
  title: string | null;
  prompt: string;
  spec: Record<string, unknown>;
  storageKey: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  status: "generating" | "ready" | "failed";
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  previewUrl?: string | null;
};
