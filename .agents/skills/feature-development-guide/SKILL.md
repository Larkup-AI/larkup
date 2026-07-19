---
name: feature-development-guide
description: Guidelines and requirements for agents when developing or adding new features to the Larkup monorepo, covering testing, analytics, modularity, environment files, and syncing CLI/SDK/Desktop/Docs.
tags: feature, testing, e2e, analytics, architecture, docker, cli, sdk, desktop, docs
---

# Feature Development Guide

When adding new features to the Larkup monorepo, you must adhere to the following principles to maintain the stability, cleanliness, and performance of the application.

## 1. End-to-End (E2E) Testing
- **Always update tests**: Whenever you add, modify, or remove a feature, you MUST update or add corresponding E2E tests (located in `e2e/`).
- **Test stability**: Ensure the application maintains continuous functional stability. Do not leave broken tests.

## 2. Analytics Tracking
- **Track usage**: If you are adding a feature that interacts with the user, makes requests to the AI/RAG server, or uses LLM tokens, you should implement analytics tracking.
- Reference the `analytics-tracking` skill for implementation details.

## 3. Clean and Extendable Code
- **Clean Code**: Follow modern TypeScript and React/Next.js best practices. Write code that is modular, readable, and easy to maintain.
- **Extendable Architecture**: Avoid hardcoding configurations. Build features in a way that allows them to be extended or reused in the future.

## 4. Keep the App Light
- **Avoid bloat**: Do not add unnecessary large dependencies to the core applications (`apps/web`, `@larkup/core`). Keep the core app light.
- **Use Packages or Marketplace Tools for Huge Features**: If a new feature is significantly large, highly specialized, or adds heavy dependencies (e.g., advanced media processing, separate model integrations):
  - Abstract it into a new package under `packages/` or
  - Make it an installable tool in the marketplace (under `packages/tools/`).
  - Reference the `marketplace-tools` and `architecture-overview` skills.

## 5. Syncing Cross-Platform Implementations (CLI, SDK, Desktop, Docs)
- **Feature Parity**: Whenever you introduce a new feature or API capability to the core server or web app, you MUST ensure that the CLI (`apps/cli`), SDKs (`apps/sdk/js-sdk`, `apps/sdk/py-sdk`), and Desktop app (`apps/desktop`) are updated to support it. All access layers must remain in sync.
- **Larkup / RAG Server**: The deployable Larkup Server (configured in the app settings) must be updated if your changes impact the custom AI generation or data serving. You must ensure the server remains perfectly deployable as a standalone service without breaking.
- **Documentation**: Any new feature, API route, Desktop feature, or CLI command must be documented immediately in `apps/docs`. Keep all related folders and files synced and accurately reflect the current state of the application.

## 6. Environment and Deployment Configuration
- **Docker**: If your new feature introduces new environment requirements, ports, or build steps, you MUST update the `docker/Dockerfile` and related `docker-compose.*.yml` files.
- **Ignores**: Keep `.npmignore` and `.dockerignore` updated. Ensure that only necessary files are published or included in the Docker image to keep the footprint small.

## 7. How to Develop Without Breaking the App
- **Run Locally**: Always verify your changes by running the app locally using `pnpm run dev`.
- **Lint and Format**: Ensure your code passes linting (`pnpm run lint`).
- **Narrow Execution**: Use `pnpm --filter <package-name> <command>` to build and test specific parts of the monorepo instead of running broad commands that might affect unrelated code.
- **Review Dependencies**: If you modify `package.json`, ensure you run `pnpm install` and check for any breaking version changes.
