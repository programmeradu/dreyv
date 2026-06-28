# Dreyv Video Stitcher

Long-running ffmpeg server that stitches Veo shots into final MP4s. Lives off
Vercel because Vercel lambdas time out at 5 minutes.

## Zero-CLI deploy (Render.com)

1. Push this repo to GitHub (already wired via Lovable's GitHub sync).
2. Go to https://dashboard.render.com → **New +** → **Blueprint**.
3. Connect the repo. Render reads `render.yaml` at the repo root and proposes
   the `dreyv-video-stitcher` web service. Click **Apply**.
4. After the first build fails (no secrets yet), open the service →
   **Environment** and set:
   - `STITCHER_SECRET` — any long random string (Render has a "Generate" button)
   - `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
     `R2_PUBLIC_BASE` — same values already on Vercel
5. Click **Manual Deploy → Deploy latest commit**. Render gives you a URL like
   `https://dreyv-video-stitcher.onrender.com`.

No terminal, no Docker, no `flyctl`, no GitHub Actions.

## Wire into Vercel

On the Next.js project set:

```
VIDEO_STITCHER_URL=https://dreyv-video-stitcher.onrender.com
VIDEO_STITCHER_SECRET=<same value as STITCHER_SECRET above>
```

`vertex-render-job.ts` auto-prefers the remote stitcher when both are set.

## Endpoint

`POST /stitch` — `Authorization: Bearer ${STITCHER_SECRET}`

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

Returns `{ ok: true, url, key, durationSec }`. Health check: `GET /healthz`.

## Alternative hosts

The same Dockerfile works on Railway (New Project → Deploy from GitHub repo →
set root `workers/video-stitcher`) or Fly.io (`flyctl deploy --remote-only`
from the `fly.toml` in this folder). Render is the simplest browser-only path.
