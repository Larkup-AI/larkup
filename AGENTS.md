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

## Package Collaboration
- Keep package APIs small, typed, and documented in the package README. Do not add banner or divider comments. Keep necessary API or invariant comments to one to three direct lines.
- Before moving or removing a package, search workspace imports, generated-server code, Docker build inputs, and E2E coverage. Do not archive a package solely because its direct imports are sparse.
- Add or update focused unit tests and run the package type-check. Package changes must also pass the cross-platform package CI matrix.
- When workspace package names or build inputs change, update `pnpm-lock.yaml`, Docker's dependency stage, and all affected documentation in the same change.

## Skills Integration
When working on specific feature sets, check the `.agents/` directory for relevant skills before executing the task.
