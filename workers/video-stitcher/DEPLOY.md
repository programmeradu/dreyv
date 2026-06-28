# Deploying the Video Stitcher

Deployment runs automatically from GitHub Actions
(`.github/workflows/deploy-video-stitcher.yml`) on every push to `main` that
touches `workers/video-stitcher/**`. You can also trigger it manually from the
Actions tab ("Run workflow").

GitHub's runners build the `Dockerfile`, push the image to Cloudflare's
managed registry, and run `wrangler deploy`. No local Docker required.

## One-time setup

Add these repo secrets at **Settings -> Secrets and variables -> Actions**:

| Secret                  | Where to get it |
| ----------------------- | --------------- |
| `CLOUDFLARE_API_TOKEN`  | CF dashboard -> My Profile -> API Tokens. Template "Edit Cloudflare Workers" + add **Account -> Workers Containers -> Edit**. |
| `CLOUDFLARE_ACCOUNT_ID` | CF dashboard -> Workers & Pages -> right sidebar. |
| `STITCHER_SECRET`       | Any long random string. Must match `VIDEO_STITCHER_SECRET` on Vercel. |
| `R2_ACCOUNT_ID`         | Same as `CLOUDFLARE_ACCOUNT_ID`. |
| `R2_BUCKET`             | R2 bucket name where stitched MP4s land. |
| `R2_ACCESS_KEY_ID`      | R2 -> Manage API tokens. |
| `R2_SECRET_ACCESS_KEY`  | Same. |
| `R2_PUBLIC_BASE`        | Public base URL of the bucket (e.g. `https://cdn.dreyv.com`). Leave blank if presigning. |

## After the first successful deploy

Wrangler prints the Worker URL (e.g.
`https://dreyv-video-stitcher.<account>.workers.dev`). Add to Vercel env:

- `VIDEO_STITCHER_URL` -> that URL
- `VIDEO_STITCHER_SECRET` -> same value as `STITCHER_SECRET` above

`src/lib/media-studio/remote-video-stitcher.ts` picks these up automatically
and the local ffmpeg fallback turns off.
