# Fly.io ffmpeg stitcher container.
# Built remotely by `flyctl deploy --remote-only` — no local Docker needed.
FROM node:20-alpine

RUN apk add --no-cache ffmpeg ca-certificates fontconfig

WORKDIR /app

COPY container/package.json ./package.json
RUN npm install --omit=dev

COPY container/ ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.mjs"]
