# Dreyv Video Stitcher (Fly.io)

Long-running ffmpeg server that stitches Veo shots into final MP4s. Lives on
Fly.io because Vercel lambdas time out at 5 minutes and Cloudflare Workers
can't run native ffmpeg.

Vercel calls it directly — no Cloudflare Worker proxy in between.

## Deploy (no Docker required locally)

```bash
cd workers/video-stitcher

# 1. One-time: create the app on Fly
flyctl launch --copy-config --no-deploy --name dreyv-video-stitcher

# 2. Set secrets
flyctl secrets set \
  STITCHER_SECRET=$(openssl rand -hex 32) \
  R2_ACCOUNT_ID=... \
  R2_BUCKET=... \
  R2_ACCESS_KEY_ID=... \
  R2_SECRET_ACCESS_KEY=... \
  R2_PUBLIC_BASE=https://media.dreyv.com

# 3. Build + deploy remotely (Fly's builder runs Docker, you don't)
flyctl deploy --remote-only
```

Fly prints the public URL, e.g. `https://dreyv-video-stitcher.fly.dev`.

## Wire into Vercel

Set on the Next.js app:

```
VIDEO_STITCHER_URL=https://dreyv-video-stitcher.fly.dev
VIDEO_STITCHER_SECRET=<same value as STITCHER_SECRET above>
```

`src/lib/media-studio/remote-video-stitcher.ts` POSTs `/stitch` with
`Authorization: Bearer ${VIDEO_STITCHER_SECRET}`. `vertex-render-job.ts`
auto-prefers the remote stitcher whenever both env vars are present.

## Endpoint

`POST /stitch` — auth `Authorization: Bearer ${STITCHER_SECRET}`

```json
{
  "jobId": "...",
  "shotUrls": ["https://...", "..."],
  "shotDurationSec": 8,
  "captions": ["...", "..."],
  "colorGrade": true,
  "upscaleTo1080": true
}
```

Returns `{ ok: true, url, key, durationSec }`.
