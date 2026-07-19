# ─────────────────────────────────────────────────────────────
# E2E Test Runner
# ─────────────────────────────────────────────────────────────

FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /e2e

# Copy only the e2e package (no app code, no host node_modules)
COPY e2e/package.json e2e/tsconfig.json ./
COPY e2e/utils/ ./utils/
COPY e2e/tests/ ./tests/
COPY e2e/demo-data/ ./demo-data/
COPY e2e/global-setup.ts e2e/global-teardown.ts ./

# Copy env files if present (the compose file also passes env vars)
COPY e2e/.env.e2e* ./

# Install deps fresh — no pnpm workspace, no caches, no host leaks
RUN npm install --ignore-scripts && npx playwright install chromium

# Default: run all tests
CMD ["npx", "playwright", "test"]
