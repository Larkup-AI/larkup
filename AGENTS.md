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

## Local / Cloud parity

- This repository owns product behavior. Cloud (`../larkup-cloud`) consumes the canonical `@larkup/*` packages and adds managed-host adapters; do not copy implementations into Cloud.
- Keep web chat, Cloud chat and public agent runs on `@larkup/workspace-server`'s shared route, prompt and tool registry. Preserve parity for RAG, CSV/chart analysis, sandbox execution, custom instructions, PDF images and video evidence when host capabilities are configured.
- Fix shared behavior here first, add focused tests and changesets, then run `./scripts/sync-packages.sh --source ../larkup` from Cloud. Include mixed tabular plus video/document cases and tenant isolation; a chart request must not fall through to media retrieval.
- Video Intelligence and its existing Modal-backed service remain canonical. Preserve source language and timestamps; use full-source artifacts/paging for complete speech, not unbounded transcript context. Do not create replacement GPU/transcription infrastructure for Cloud.
- Read Cloud's `docs/shared-feature-parity.md` for the ownership map and release/acceptance checklist. Linked-source success does not prove npm release or production deployment; record the exact tested revision and distinguish mocked tests from live evidence.
- Use functional names for new branches, files and commits, without agent-specific prefixes. Use `mktemp -d` for temporary worktrees and keep temporary operational scripts outside the repository.

## Skills Integration
When working on specific feature sets, check the `.agents/` directory for relevant skills before executing the task.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
