# Dreyv Video Stitcher — Cloudflare Container image
#
# This container runs alongside the Worker (via the [[containers]] binding in
# wrangler.toml). It exposes a single POST /stitch endpoint that downloads the
# Veo shot MP4s, runs the same ffmpeg pipeline we used to run on Vercel, and
# uploads the final MP4 to R2. Because containers don't have the 5-min Vercel
# lambda timeout, multi-shot stitches finally finish.

FROM node:20-alpine

# ffmpeg with libfreetype so the drawtext caption filter actually exists.
RUN apk add --no-cache ffmpeg ca-certificates && \
    addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY container/package.json container/package-lock.json* ./
RUN npm install --omit=dev

COPY container/server.mjs ./server.mjs
COPY container/fonts ./fonts

ENV PORT=8080 \
    NODE_ENV=production

EXPOSE 8080

USER app

CMD ["node", "server.mjs"]
