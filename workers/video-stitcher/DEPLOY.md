# Deploying the Video Stitcher

Two pieces, neither needs local Docker:

1. **Fly.io app** — runs the Node + ffmpeg server (`container/server.mjs`).
   Fly builds the `Dockerfile` on its remote builders.
2. **Cloudflare Worker** — plain Worker (`src/worker.ts`) that proxies
   `/stitch` to the Fly app. Deploys via `wrangler` / the CF API.

## 1. Fly.io (ffmpeg host)

```sh
cd workers/video-stitcher
flyctl launch --copy-config --no-deploy            # creates app "dreyv-video-stitcher"
flyctl secrets set \
  STITCHER_SECRET=...        \
  R2_ACCOUNT_ID=...          \
  R2_BUCKET=...              \
  R2_ACCESS_KEY_ID=...       \
  R2_SECRET_ACCESS_KEY=...   \
  R2_PUBLIC_BASE=...
flyctl deploy --remote-only                         # remote build, no local Docker
```

Note the URL Fly prints (e.g. `https://dreyv-video-stitcher.fly.dev`).

## 2. Cloudflare Worker (proxy)

Auto-deploys from `.github/workflows/deploy-video-stitcher.yml` on push to
`main`. Required GitHub repo secrets:

| Secret                  | Value |
| ----------------------- | ----- |
| `CLOUDFLARE_API_TOKEN`  | Token with Workers Scripts:Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Your CF account id |
| `STITCHER_SECRET`       | Same value as on Fly + as `VIDEO_STITCHER_SECRET` on Vercel |
| `FFMPEG_HOST_URL`       | Fly URL from step 1 |

Or manually:

```sh
cd workers/video-stitcher
npm install
echo "$STITCHER_SECRET" | npx wrangler secret put STITCHER_SECRET
echo "$FFMPEG_HOST_URL" | npx wrangler secret put FFMPEG_HOST_URL
npx wrangler deploy
```

## 3. Vercel env

Wrangler prints the Worker URL (e.g.
`https://dreyv-video-stitcher.<account>.workers.dev`). Add on Vercel:

- `VIDEO_STITCHER_URL` → that Worker URL
- `VIDEO_STITCHER_SECRET` → same value as `STITCHER_SECRET`

`src/lib/media-studio/remote-video-stitcher.ts` picks these up automatically
and the local ffmpeg fallback turns off.

## Health checks

```sh
curl https://dreyv-video-stitcher.<account>.workers.dev/health   # Worker
curl https://dreyv-video-stitcher.fly.dev/health                 # Fly host
```
