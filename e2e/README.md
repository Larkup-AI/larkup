# E2E Tests

Playwright-based tests covering Web UI, API, SDK, CLI, and installation.

## Prerequisites

```bash
pnpm dev          # start dev server on :4567
```

## Run

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

## Env

API keys are loaded from the root `.env` file (gitignored). The `e2e/utils/env-loader.ts` reads from `../../.env` relative to the utils directory. Tests that require missing keys are automatically skipped.

To set up your environment variables, copy the example file:
```bash
cp e2e/.env.example e2e/.env.e2e
```
Then fill in your actual API keys. Alternatively, ensure the root `.env` has the necessary keys.

## Test Structure

```
e2e/
├── tests/
│   ├── web-ui/      # Browser-based UI tests (numbered for serial order)
│   ├── api/         # HTTP-level API route tests
│   ├── sdk/         # JS & Python SDK client tests
│   ├── cli/         # CLI command tests
│   └── installation/ # Install method smoke tests
├── utils/           # Shared fixtures, env loader, server waiter
├── demo-data/       # Test fixture files (PDF, TXT, DOCX, etc.)
├── playwright.config.ts
├── global-setup.ts
└── global-teardown.ts
```
