FROM node:20-slim AS base

FROM base AS deps
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install pnpm
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/cli/package.json ./apps/cli/
COPY packages/core/package.json ./packages/core/
COPY packages/scraper/package.json ./packages/scraper/
COPY packages/vector-stores/package.json ./packages/vector-stores/

RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY --from=deps /app /app
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter larkup build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
RUN mkdir -p /app/apps/web/.next && chown nextjs:nodejs /app/apps/web/.next

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Install LanceDB native binding directly for the target platform.
RUN npm install --no-save @lancedb/lancedb@0.30.0 && \
    chown -R nextjs:nodejs node_modules/@lancedb node_modules/apache-arrow node_modules/reflect-metadata

USER nextjs

EXPOSE 4567

ENV PORT=4567

CMD ["node", "apps/web/server.js"]
