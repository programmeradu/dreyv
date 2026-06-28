# Dreyv Video Stitcher (Cloudflare Container Worker)

Long-running ffmpeg stitcher that replaces the Vercel-side stitch pass. Vercel
times out at 5 min on multi-shot encodes; this container has no such limit.

## Architecture

```
Vercel  ─POST /stitch──▶  Worker (dreyv-video-stitcher)
                                │  routes to a Durable Object pinned by jobId
                                ▼
                          Container (node:20-alpine + ffmpeg)
                                │  downloads shots, normalize+concat+grade
                                ▼
                          R2 (final MP4)  ─presigned URL──▶ Vercel
```

## Deploy

```sh
cd workers/video-stitcher
npm install
npx wrangler secret put STITCHER_SECRET        # same value as VIDEO_STITCHER_SECRET on Vercel
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_BUCKET
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put R2_PUBLIC_BASE         # optional (omit to use presigned URLs)
npx wrangler deploy
```

The container image is built from `./Dockerfile` automatically by `wrangler
deploy`.

## Vercel env

Set on Vercel so the Next.js app forwards stitch jobs to this Worker:

- `VIDEO_STITCHER_URL` — e.g. `https://dreyv-video-stitcher.<account>.workers.dev`
- `VIDEO_STITCHER_SECRET` — same value as `STITCHER_SECRET` above

When unset, `src/lib/media-studio/vertex-render-job.ts` falls back to the local
ffmpeg stitcher (which will keep timing out on Vercel — that's the whole reason
this Worker exists).

## Health

```sh
curl https://dreyv-video-stitcher.<account>.workers.dev/health
```
