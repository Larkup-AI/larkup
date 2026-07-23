FROM node:20-slim AS base

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install pnpm
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/cli/package.json ./apps/cli/
COPY apps/desktop/package.json ./apps/desktop/
COPY e2e/package.json ./e2e/
COPY apps/larkup-proxy/package.json ./apps/larkup-proxy/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/marketplace/package.json ./packages/marketplace/
COPY packages/sandbox/package.json ./packages/sandbox/
COPY packages/scraper/package.json ./packages/scraper/
COPY packages/vector-stores/package.json ./packages/vector-stores/
COPY packages/tools/clip-embeddings/package.json ./packages/tools/clip-embeddings/
COPY packages/tools/doc-editor/package.json ./packages/tools/doc-editor/
COPY packages/tools/video-audio/package.json ./packages/tools/video-audio/
COPY apps/hub/package.json ./apps/hub/

RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY --from=deps /app /app
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter larkup build
RUN pnpm --filter @larkup/tool-video-audio build

FROM base AS runner
WORKDIR /app

ARG TARGETARCH
ARG YT_DLP_VERSION=2026.07.04

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV LARKUP_BUNDLED_TOOLS=video-audio

# FFmpeg/ffprobe are the only native media-processing dependency. Use yt-dlp's
# pinned standalone binary so YouTube support does not pull in a Python runtime.
# Transcription and vision remain API-based; there is no local ML runtime or
# queue service.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    case "$TARGETARCH" in \
      amd64) YT_DLP_ASSET=yt-dlp_linux; YT_DLP_SHA256=6bbb3d314cde4febe36e5fa1d55462e29c974f63444e707871834f6d8cc210ae ;; \
      arm64) YT_DLP_ASSET=yt-dlp_linux_aarch64; YT_DLP_SHA256=b6ce97646773070d7a7ffd6bbbdcaecb47c48483909c54c915bf08a7a9b5e0b1 ;; \
      *) echo "Unsupported architecture for yt-dlp: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${YT_DLP_ASSET}" \
    node -e 'fetch(process.env.YT_DLP_URL).then(r => { if (!r.ok) throw new Error(`Download failed: ${r.status}`); return r.arrayBuffer(); }).then(data => require("node:fs").writeFileSync("/usr/local/bin/yt-dlp", Buffer.from(data)))' && \
    echo "$YT_DLP_SHA256  /usr/local/bin/yt-dlp" | sha256sum -c - && \
    chmod 0755 /usr/local/bin/yt-dlp

ENV TMPDIR=/app/.tmp

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
RUN mkdir -p /app/apps/web/.next && chown nextjs:nodejs /app/apps/web/.next

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Install LanceDB native binding directly for the target platform.
RUN npm install --no-save @lancedb/lancedb@0.30.0 fluent-ffmpeg@2.1.3 && \
    chown -R nextjs:nodejs node_modules/@lancedb node_modules/apache-arrow node_modules/reflect-metadata && \
    mkdir -p /app/.larkup /app/.tmp && \
    chown -R nextjs:nodejs /app/.larkup /app/.tmp

# The marketplace loader imports bundled tools dynamically, so Next's static
# tracing cannot discover them. Copy it after npm install so npm cannot prune it.
COPY --from=builder --chown=nextjs:nodejs /app/packages/tools/video-audio ./node_modules/@larkup/tool-video-audio

VOLUME ["/app/.larkup"]

USER nextjs

EXPOSE 4567

ENV PORT=4567

CMD ["node", "apps/web/server.js"]
