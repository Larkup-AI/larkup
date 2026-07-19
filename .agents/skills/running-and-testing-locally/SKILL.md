---
name: running-and-testing-locally
description: Guidelines and instructions for running the monorepo locally, performing RAG tests via CLI, and writing/running automated tests.
tags: testing, development, running, e2e
---

# Running and Testing Larkup Locally

## Starting the Application

Larkup uses `pnpm` workspaces and `turbo` for task running.

**To run the main web app and API in development mode:**
```bash
pnpm run dev
```
This will start Next.js on `localhost:4567` (or the configured port).

**To build the entire project:**
```bash
pnpm build
```

**To start the production build:**
```bash
pnpm start
```

## Running the CLI

You can run the CLI from the root using the `@larkup/cli` filter:
```bash
pnpm --filter @larkup/cli rag
```

## Testing

Larkup employs testing via Turborepo.

**Run unit tests across all packages:**
```bash
pnpm test
```

### E2E Testing (Playwright)

E2E tests live in `e2e/` at the repository root. We use Playwright for end-to-end testing covering:
- **Web UI** (`tests/web-ui/`): Browser-based tests for the Next.js dashboard.
- **API** (`tests/api/`): HTTP-level tests for all `/api/*` routes.
- **SDK** (`tests/sdk/`): Tests for JS and Python SDK clients against the RAG server.
- **CLI** (`tests/cli/`): CLI command tests via `child_process`.
- **Installation** (`tests/installation/`): Smoke tests for install methods (pnpm, npm, Docker).

**To run E2E tests (requires dev server running on :4567):**
```bash
# All tests
scripts/test-e2e.sh

# By suite
scripts/test-e2e.sh --suite web
scripts/test-e2e.sh --suite api
scripts/test-e2e.sh --suite sdk
scripts/test-e2e.sh --suite cli
scripts/test-e2e.sh --suite install

# With browser visible
scripts/test-e2e.sh --suite web --headed

# Single file
cd e2e && pnpm exec playwright test tests/api/config.spec.ts

# View report
cd e2e && pnpm exec playwright show-report
```

Or run directly via Docker for isolated network testing:
```bash
docker compose -f docker/docker-compose.e2e.yml up --abort-on-container-exit
```

**Env setup:**
```bash
# Keys are loaded from the root .env file (already gitignored).
# E2E env-loader reads from ../../.env relative to e2e/utils/.
# Tests that require missing keys are auto-skipped via hasEnv() checks.
```

### Writing E2E Tests

1. **Naming**: Use numbered prefixes for Web UI tests (`01-navigation.spec.ts`, `02-data.spec.ts`) to control execution order in serial mode.
2. **Selectors**: Prefer accessible ARIA roles (`getByRole`, `getByText`) over CSS selectors. Use `data-testid` only when ARIA isn't sufficient.
3. **Fixtures**: Import test data from `e2e/utils/fixtures.ts`. Demo files live in `e2e/demo-data/`.
4. **API URLs**: Use Playwright's built-in `baseURL` (via `request` fixture) instead of hardcoding `http://localhost:4567`.
5. **Env-gating**: Skip tests that require external API keys using `test.skip(!hasEnv(ENV_KEYS.X), '...')`.
6. **Timeouts**: Set generous `test.setTimeout()` for operations involving AI models or network calls.
9. **Cleanup**: Always clean up created resources (documents, etc.) in `test.afterAll` or inline.

## Agent Responsibilities for Testing

When modifying the codebase, you (the agent) must ensure that the test suite remains in a passing state. This means:
1. **Adding Features**: If you implement a new feature, you MUST write corresponding tests (unit or E2E as appropriate) to cover the new functionality.
2. **Updating Features**: If you modify existing functionality, you MUST update the affected tests to align with the new behavior.
3. **Removing Features**: If you deprecate or remove a feature, you MUST remove or gracefully disable the tests that cover it so they do not fail.
4. **Validation**: Do not consider a task fully complete until the affected tests run and pass. Keep the application's functional integrity a top priority at all times.
