import { isR2Configured, presignR2Get, putR2Object } from "@/lib/agents/artifacts/r2-storage";

async function main() {
  console.log("R2 configured:", isR2Configured());

  // Try to fetch a recent asset from Neon
  let key: string | null = null;
  let mime = "image/png";
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`SELECT storage_key, mime_type FROM media_studio_assets WHERE storage_key IS NOT NULL ORDER BY created_at DESC LIMIT 1` as any[];
    if (rows.length) {
      key = rows[0].storage_key;
      mime = rows[0].mime_type || mime;
      console.log("Found existing asset:", key, mime);
    }
  } catch (e) {
    console.log("DB lookup failed:", (e as Error).message);
  }

  // If no asset exists, upload a tiny test PNG
  if (!key) {
    key = `media-studio/_diagnostic/${Date.now()}.png`;
    // 1x1 transparent PNG
    const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const body = Buffer.from(pngB64, "base64");
    console.log("Uploading test object:", key, "bytes:", body.length);
    await putR2Object({ key, body, mime: "image/png", filename: "diagnostic.png" });
    console.log("Upload OK");
  }

  const url = await presignR2Get({ key: key!, filename: "diagnostic.png", mime, inline: true });
  console.log("Presigned URL (truncated):", url.slice(0, 140) + "...");

  const res = await fetch(url);
  console.log("GET status:", res.status, res.statusText);
  console.log("Content-Type:", res.headers.get("content-type"));
  console.log("Content-Length:", res.headers.get("content-length"));
  if (!res.ok) {
    console.log("Body:", (await res.text()).slice(0, 600));
  } else {
    const buf = Buffer.from(await res.arrayBuffer());
    console.log("Bytes received:", buf.length, "first4hex:", buf.slice(0,4).toString("hex"));
  }
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
