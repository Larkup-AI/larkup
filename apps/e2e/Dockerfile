# ─────────────────────────────────────────────────────────────
# E2E Test Runner
# ─────────────────────────────────────────────────────────────

FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /e2e

# Copy only the e2e package (no app code, no host node_modules)
COPY apps/e2e/package.json apps/e2e/tsconfig.json ./
COPY apps/e2e/utils/ ./utils/
COPY apps/e2e/tests/ ./tests/
COPY apps/e2e/demo-data/ ./demo-data/
COPY apps/e2e/global-setup.ts apps/e2e/global-teardown.ts ./

# Copy env files if present (the compose file also passes env vars)
COPY apps/e2e/.env.e2e* ./

# Install deps fresh — no pnpm workspace, no caches, no host leaks
RUN npm install --ignore-scripts && npx playwright install chromium

# Default: run all tests
CMD ["npx", "playwright", "test"]
