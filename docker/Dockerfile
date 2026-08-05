FROM node:22-slim AS base

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install pnpm
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY patches ./patches/
COPY apps/api/package.json ./apps/api/
COPY apps/cli/package.json ./apps/cli/
COPY apps/desktop/package.json ./apps/desktop/
COPY e2e/package.json ./e2e/
COPY apps/larkup-proxy/package.json ./apps/larkup-proxy/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/integrations/package.json ./packages/integrations/
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

ARG NEXT_PUBLIC_DOCKER_ENV=true
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_DOCKER_ENV=${NEXT_PUBLIC_DOCKER_ENV}

RUN pnpm --filter @larkup/sandbox build
RUN pnpm --filter @larkup/tool-doc-editor build
RUN pnpm --filter @larkup/tool-video-audio build
RUN pnpm --filter larkup build

FROM base AS runner
WORKDIR /app

ARG YT_DLP_VERSION=2026.07.04

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# FFmpeg/ffprobe support media processing. Install the pinned Python distribution
# of yt-dlp instead of its architecture-specific binary: it runs reliably under
# Docker Desktop's amd64 emulation as well as native Linux hosts.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates python3-pip && \
    rm -rf /var/lib/apt/lists/* && \
    python3 -m pip install --no-cache-dir --break-system-packages "yt-dlp==${YT_DLP_VERSION}" && \
    yt-dlp --version

ENV TMPDIR=/app/.tmp

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
RUN mkdir -p /app/apps/web/.next && chown nextjs:nodejs /app/apps/web/.next

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Install LanceDB native binding directly for the target platform.
RUN npm install --no-save @lancedb/lancedb@0.31.0 fluent-ffmpeg@2.1.3 && \
    chown -R nextjs:nodejs node_modules/@lancedb node_modules/apache-arrow node_modules/reflect-metadata && \
    mkdir -p /app/.larkup /app/.tmp && \
    chown -R nextjs:nodejs /app/.larkup /app/.tmp

VOLUME ["/app/.larkup"]

USER nextjs

EXPOSE 4567 8080

ENV PORT=4567

CMD ["node", "apps/web/server.js"]
