"use client";

import * as React from "react";
import type { MediaAsset } from "@/lib/media-studio/types";
import { Trash2, Image as ImageIcon, FileText, Layout, Video } from "lucide-react";
import { studioAuthHeaders } from "@/lib/media-studio/client-auth";

/**
 * Library grid for previously-generated media assets. Reads from
 * /api/studio/media/assets and supports delete.
 */
export function AssetLibrary({ refreshKey }: { refreshKey: number }) {
  const [assets, setAssets] = React.useState<MediaAsset[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/studio/media/assets", { headers: studioAuthHeaders() });
      const json = await res.json();
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

  if (loading) {
    return <div className="text-sm text-[#0B0820]/60">Loading library…</div>;
  }

  if (assets.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-violet-200 bg-white p-10 text-center">
        <div className="text-sm text-[#0B0820]/60">No assets yet. Generate something on the left to fill this shelf.</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {assets.map((a) => (
        <div key={a.id} className="group relative overflow-hidden rounded-3xl border border-violet-200 bg-white">
          {a.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.previewUrl} alt={a.title ?? a.prompt} className="aspect-square w-full object-cover" />
          ) : (
            <TextPreview asset={a} />
          )}
          <div className="border-t border-violet-100 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-violet-700">
                <KindIcon kind={a.kind} />
                {a.kind}
                {a.channel && <span className="text-[#0B0820]/40">· {a.channel}</span>}
              </div>
              <button
                onClick={() => remove(a.id)}
                className="text-[#0B0820]/40 opacity-0 transition group-hover:opacity-100 hover:text-red-600"
                aria-label="Delete asset"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-1 line-clamp-2 text-xs text-[#0B0820]/70">{a.title ?? a.prompt}</div>
          </div>
        </div>
      ))}
    </div>
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
    <div className="flex aspect-square flex-col justify-between bg-gradient-to-br from-white to-violet-50 p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">
        {asset.kind}
      </div>
      <div className="line-clamp-6 text-sm font-medium text-[#0B0820]">
        {asset.title ?? asset.prompt}
      </div>
      <div className="text-[10px] text-[#0B0820]/40">
        {new Date(asset.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}
