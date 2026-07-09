# Stage 1: Build
FROM node:20-slim AS builder
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Install build tools
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . . 

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build environment - keep memory within Docker limits
ENV DOCKER_BUILD=1
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NEXT_TELEMETRY_DISABLED=1

# Build the web app
RUN pnpm --filter=larkup-rag build

# Prepare @lancedb native bindings for the runner stage.
# pnpm stores optional native deps (NAPI-RS .node files) inside its .pnpm
# virtual store.  Next.js standalone output-file-trace misses them, so we
# collect them here and copy them into the runner's node_modules.
RUN mkdir -p /lancedb-native && \
    LANCEDB_DIR=$(find /app/node_modules/.pnpm -maxdepth 1 -name '@lancedb+lancedb@*' -type d | head -1) && \
    if [ -d "$LANCEDB_DIR/node_modules/@lancedb" ]; then \
        cp -r "$LANCEDB_DIR/node_modules/@lancedb" /lancedb-native/; \
    fi
    
# Stage 2: Runner
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DOCKER_BUILD=1

RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 nextjs

RUN mkdir -p /app/data \
    /app/apps/web/data && \
    chown -R nextjs:nodejs /app/data /app/apps && \
    chmod -R 755 /app/data /app/apps

# Copy Next.js standalone server
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# Copy @lancedb native bindings (NAPI-RS) that standalone trace missed
COPY --from=builder --chown=nextjs:nodejs /lancedb-native/@lancedb ./node_modules/@lancedb

USER nextjs
EXPOSE 4567
ENV PORT=4567
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]