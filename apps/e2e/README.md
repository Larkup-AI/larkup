# E2E Tests

Playwright-based tests covering Web UI, API, SDK, CLI, and installation.

## Prerequisites

```bash
pnpm dev          # start dev server on :4567
mintlify dev      # (optional) start docs on :3000
```

## Run

```bash
# all tests
./test-e2e.sh

# by suite
./test-e2e.sh --suite web
./test-e2e.sh --suite api
./test-e2e.sh --suite sdk
./test-e2e.sh --suite cli
./test-e2e.sh --suite install

# with browser visible
./test-e2e.sh --suite web --headed

# single file
cd apps/e2e && npx playwright test tests/api/config.spec.ts

# view report
cd apps/e2e && npx playwright show-report
```

## Env

API keys are loaded from `apps/e2e/.env.e2e`. Tests that require missing keys are auto-skipped.

To set up your environment variables, copy the example file:
```bash
cp apps/e2e/.env.e2e.example apps/e2e/.env.e2e
```
Then, fill in your actual API keys in `apps/e2e/.env.e2e`.
