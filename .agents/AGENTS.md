# Workspace Agents Rules

Welcome to the Larkup workspace.

Agent capabilities and instructions are modularized into skills inside the `.agents/skills/` directory. The AI will automatically discover and load the appropriate skills based on your task.

## Available Skills
- **architecture-overview**: High-level monorepo architecture and package dependency layers.
- **analytics-tracking**: Usage analytics tracking implementation details.
- **database-guide**: Database interactions, vector stores, and data ingestion.
- **docs-guide**: Documentation guidelines (Mintlify docs + inline code docs).
- **marketplace-tools**: Guide for adding new marketplace tools/plugins.
- **running-and-testing-locally**: Running the app locally, CLI usage, and E2E testing.
- **ui-development-guide**: UI and frontend best practices (Shadcn, Tailwind v4, Framer Motion).

## Workflow Standards

1. **Git Hooks (.husky)**: We use Husky to run `lint-staged` on pre-commit. Ensure your code passes linting before committing.
2. **Versioning (.changeset)**: Use the Changesets CLI (`pnpm changeset`) when making modifications to packages to track versions and generate changelogs. Reference `.agents/commands/changeset.md` for guidelines.
3. **Dependencies Patching (patches/)**: If an NPM dependency has a bug, use `pnpm patch <pkg>` and save the patch file to the `patches/` directory.
4. **Scripts (scripts/)**: All monorepo utility scripts (`run.sh`, `start.sh`, `test-e2e.sh`, `auto-publish.sh`, etc.) are located in the `scripts/` directory. Do not place new scripts in the root directory.
5. **Docker Infrastructure (docker/)**: The `docker/` directory is the single source of truth for all containerization setups, including `docker-compose.dev.yml` and `docker-compose.e2e.yml`. Do not place Docker files in the root directory.
6. **E2E Tests (e2e/)**: End-to-end tests live in the `e2e/` directory at the repo root. Run them with `scripts/test-e2e.sh` or `pnpm --filter @larkup/e2e test`.
7. **Agent Testing Mandate**: Whenever you add, update, or remove a feature, you MUST actively handle updates to the corresponding tests (unit or E2E). This ensures the application maintains continuous functional stability.
