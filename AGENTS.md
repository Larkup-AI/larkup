# Larkup Workspace Agents Rules

Unless user explicitly asks, do not inspect or modify the `archive` or `dummy` folders.
Always prefer the most specific agent instructions for the area you are modifying. Detailed skills and project guidelines are located in `.agents/skills/` (e.g., UI development, analytics, database guidelines).

## Monorepo Rules
- **Package Manager**: We use `pnpm` workspace with `turborepo`.
- **TypeScript**: All packages use strict TypeScript.

## Development Workflow
- **Narrow Execution**: Prefer narrowest package commands. Instead of running a command on the whole monorepo, use `pnpm --filter <package-name> <command>`.
- **Running Locally**: Use `pnpm run dev` in the root to spin up the primary apps and packages simultaneously.
- **Building**: Use `pnpm build` to build everything, or `pnpm turbo build --filter <package-name>` to target a specific piece. Avoid full monorepo builds when testing local changes to a single leaf node.
- **Versioning**: Always use `pnpm changeset` for versioning packages when introducing features or fixes.
- **E2E Testing**: Run `scripts/test-e2e.sh` or `cd e2e && pnpm exec playwright test` against a running dev server.

## Skills Integration
When working on specific feature sets, check the `.agents/` directory for relevant skills before executing the task.
