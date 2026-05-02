"use client";

import * as React from "react";
import type { MediaAsset } from "@/lib/media-studio/types";
import { Trash2, Image as ImageIcon, FileText, Layout, Video } from "lucide-react";
import { studioAuthHeaders } from "@/lib/media-studio/client-auth";
import { ImageActions, ImageLightbox, safeFilename } from "@/components/media-studio/ImageViewer";

async function readJsonSafe(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return { assets: [] };
  try {
    return JSON.parse(text);
  } catch {
    return { assets: [], error: `Unexpected server response (${res.status})` };
  }
}

export function AssetLibrary({ refreshKey }: { refreshKey: number }) {
  const [assets, setAssets] = React.useState<MediaAsset[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [lightbox, setLightbox] = React.useState<{ url: string; alt: string; filename: string } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/studio/media/assets", { headers: studioAuthHeaders() });
      const json = await readJsonSafe(res);
      if (res.ok) setAssets(json.assets ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load, refreshKey]);

  async function remove(id: string) {
    if (!confirm("Delete this asset?")) return;
    const res = await fetch(`/api/studio/media/assets/${id}`, { method: "DELETE", headers: studioAuthHeaders() });
    if (res.ok) setAssets((a) => a.filter((x) => x.id !== id));
  }

  if (loading) return <div className="text-sm text-studio-muted">Loading library…</div>;

  if (assets.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-studio-border bg-studio-surface p-10 text-center">
        <div className="text-sm text-studio-muted">Saved assets will appear here.</div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {assets.map((a) => {
          const alt = a.title ?? a.prompt ?? "Saved asset";
          const filename = safeFilename(a.title ?? a.prompt ?? `dreyv-${a.kind}`);
          return (
            <div key={a.id} className="group relative overflow-hidden rounded-3xl border border-studio-border bg-studio-surface">
              {a.previewUrl ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.previewUrl}
                    alt={alt}
                    className="aspect-square w-full cursor-zoom-in object-cover"
                    onClick={() => setLightbox({ url: a.previewUrl!, alt, filename })}
                  />
                  <ImageActions
                    url={a.previewUrl}
                    alt={alt}
                    filename={filename}
                    onView={() => setLightbox({ url: a.previewUrl!, alt, filename })}
                  />
                </div>
              ) : (
                <TextPreview asset={a} />
              )}
              <div className="border-t border-studio-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-studio-violet">
                    <KindIcon kind={a.kind} />
                    {a.kind}
                    {a.channel && <span className="text-studio-muted">· {a.channel}</span>}
                  </div>
                  <button
                    onClick={() => remove(a.id)}
                    className="text-studio-muted opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                    aria-label="Delete asset"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-studio-muted">{a.title ?? a.prompt}</div>
              </div>
            </div>
          );
        })}
      </div>
      {lightbox && (
        <ImageLightbox
          url={lightbox.url}
          alt={lightbox.alt}
          filename={lightbox.filename}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

function KindIcon({ kind }: { kind: MediaAsset["kind"] }) {
  const cls = "h-3 w-3";
  if (kind === "post") return <FileText className={cls} />;
  if (kind === "infographic") return <Layout className={cls} />;
  if (kind === "announcement") return <ImageIcon className={cls} />;
  return <Video className={cls} />;
}

function TextPreview({ asset }: { asset: MediaAsset }) {
  return (
    <div className="flex aspect-square flex-col justify-between bg-studio-violet-soft p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-studio-violet">{asset.kind}</div>
      <div className="line-clamp-6 text-sm font-medium text-studio-fg">{asset.title ?? asset.prompt}</div>
      <div className="text-[10px] text-studio-muted">{new Date(asset.createdAt).toLocaleDateString()}</div>
    </div>
  );
}
