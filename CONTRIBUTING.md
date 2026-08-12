# Contributing to Larkup

Welcome to the Larkup contributing guide! We appreciate any and all contributions.

There are many ways to contribute to Larkup:

- Report bugs and suggest features via GitHub Issues.
- Fix bugs and implement features (see our open issues to get started).
- Improve documentation and expand test coverage.
- Create tools, skills, or knowledge integrations for the Marketplace.

## Local Development

Larkup is a monorepo utilizing [pnpm](https://pnpm.io/) and [Turborepo](https://turbo.build/).

### Setup Instructions

1. Make sure you have Node.js installed (v20+ recommended). We use `.nvmrc` to specify the exact version.
2. Install `pnpm` globally if you haven't already: `npm install -g pnpm`.
3. Install dependencies by running `pnpm install` in the root folder.
4. (Optional) Boot required infrastructure using Docker: `cd docker && docker compose -f docker-compose.dev.yml up -d`.
5. Copy `.env.example` to `.env` and fill in required values for any services you're working on.
6. Start the development server across all packages and apps:
   ```bash
   pnpm run dev
   ```
7. The primary web app usually runs on `http://localhost:3000` (refer to terminal output for specifics).

### Running Individual Packages

Prefer narrowest-scope commands over monorepo-wide builds:

```bash
# Build a single package
pnpm turbo build --filter @larkup/core

# Type-check a single package
pnpm turbo type-check --filter @larkup/core

# Run tests in a single package
pnpm --filter @larkup/core test

# Build everything
pnpm build
```

### Linting and Formatting

We enforce code quality and formatting through Husky hooks and lint-staged.
- **Formatting**: We use Prettier. Code is automatically formatted on commit.
- **Linting**: We use ESLint. You can run `pnpm lint` to check for issues.
- **Type checking**: Run `pnpm turbo type-check` to check for TypeScript errors.

### Testing

```bash
# Unit tests
pnpm turbo test

# E2E tests (requires a running dev server)
cd e2e && pnpm exec playwright test

# Or use the helper script
scripts/test-e2e.sh
```

## Package Ownership

| Package | Owner area | Description |
|---------|-----------|-------------|
| `@larkup/core` | Core | Config store, document store, indexer, embedder, server generation |
| `@larkup/vector-stores` | Core | Vector database adapters (LanceDB, Pinecone, etc.) |
| `@larkup/scraper` | Core | URL scraping and text extraction |
| `@larkup/agent-contracts` | Agent | Agent/tool/skill types, manifest v2, origin policy, wire protocol |
| `@larkup/agent-widget` | Agent | Embeddable browser chat widget (Shadow DOM, single IIFE bundle) |
| `@larkup/marketplace` | Marketplace | Tool registry, installer, loader, manifest validation |
| `@larkup/sandbox` | Security | Code sandbox execution |
| `@larkup/tool-video-audio` | Tools | Video/audio processing tool |
| `@larkup/tool-doc-editor` | Tools | Document editing tool |
| `apps/web` | Dashboard | Next.js web application and API server |
| `apps/hub` | Marketplace | Hub API — catalog, publishing, install tracking |
| `apps/cli` | CLI | Command-line interface |
| `apps/sdk/js-sdk` | SDK | JavaScript/TypeScript SDK client |
| `apps/sdk/py-sdk` | SDK | Python SDK client |
| `apps/larkup-proxy` | Integrations | OAuth proxy for knowledge source integrations |
| `apps/desktop` | Desktop | Tauri desktop application |

Future packages (created by upcoming tasks):
- `packages/agent-runtime` — Agent execution engine (currently `@larkup/core/agent-runtime`)
- `packages/agent-react` — React/Next.js bindings

## Commits & Pull Requests

1. **Branch Naming**: Use descriptive branch names (e.g., `feat/add-new-dashboard` or `fix/header-alignment`). If you have a ticket tracking system, prefix with the ticket ID.
2. **Versioning with Changesets**: Since Larkup is a monorepo, we use [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs.
   - If your PR introduces user-facing changes or modifies packages, run `pnpm changeset` and follow the prompts.
   - Commit the generated `.md` file inside the `.changeset` directory along with your code.
   - Reference `.agents/commands/changeset.md` for detailed guidelines.
3. **Commit Messages**: We follow [Conventional Commits](https://www.conventionalcommits.org/). We have `commitlint` configured.
   - Format: `type(scope): concise outcome`
   - Examples: `feat(agent-runtime): add immutable agent releases`, `fix(video-audio): preserve legacy artifact mapping`
4. **Pull Requests**:
   - Keep pull requests focused and small.
   - Fill out the provided PR template.
   - Ensure CI checks (lint, type-check, build, test) pass before requesting a review.

## Environment Variables

- **Never commit secrets** to source code, Markdown, logs, fixtures, or commits.
- Each app/service has its own `.env` or `.env.example`. Do not mix them.
- `apps/hub/.env: DATABASE_URL` → Marketplace-only database. See [ADR-008](docs/adrs/adr-008-hub-neon-ownership.md).
- Root `.env: DATABASE_URL` → Reserved for future Cloud control plane. See [ADR-008](docs/adrs/adr-008-hub-neon-ownership.md).
- Use descriptive placeholder values in `.env.example` files (e.g., `YOUR_API_KEY_HERE`).

## Marketplace: local Postgres, no Neon account needed

`apps/hub`'s catalog is durable Postgres (`packages/hub-db`, Drizzle), but
`apps/hub/.env`'s `DATABASE_URL` is gitignored and reachable only by the
deployed service — nobody gets that credential, and you don't need it to work
on the Marketplace:

```bash
docker compose -f docker/hub-db.yml up -d          # throwaway local Postgres, port 5433
cp packages/hub-db/.env.example packages/hub-db/.env
pnpm --filter @larkup/hub-db migrate               # apply committed migrations
pnpm --filter @larkup/hub-db seed                  # publish the built-in tools
pnpm --filter @larkup/hub-db test                  # repository-layer tests
pnpm --filter @larkup/hub test                     # /v1/* route contract tests
pnpm --filter @larkup/hub dev                      # local Hub on :3456
```

Schema changes go in `packages/hub-db/src/schema/*.ts`; run `pnpm --filter
@larkup/hub-db generate` to produce a migration file in `packages/hub-db/drizzle/`
and commit it alongside the schema change — migrations are reviewed like code,
not applied ad hoc. `apps/hub` owns no SQL: every query lives in
`packages/hub-db/src/repo.ts` as a typed function.

PR previews that touch the Hub use Neon branching instead of this container —
see the TASK 03 card in `plan.md` §15 for the branch-per-PR flow. That needs
`NEON_API_KEY`/CI secrets a maintainer provisions separately; it is not part
of the local contributor path above.

## Architecture Overview

Refer to `.agents/skills/architecture-overview/SKILL.md` for a high-level overview of the monorepo structure, package responsibilities, and core technologies.

### Architecture Decision Records

Key architectural decisions are documented in `docs/adrs/`:

| ADR | Decision |
|-----|----------|
| [ADR-001](docs/adrs/adr-001-knowledge-vs-agent.md) | Knowledge Server vs Agent boundary |
| [ADR-002](docs/adrs/adr-002-agent-releases.md) | Immutable Agent Releases |
| [ADR-003](docs/adrs/adr-003-extension-manifest-v2.md) | Extension manifest v2 and four kinds |
| [ADR-004](docs/adrs/adr-004-key-model.md) | Scoped key model |
| [ADR-005](docs/adrs/adr-005-output-blocks.md) | Generic output blocks |
| [ADR-006](docs/adrs/adr-006-oss-cloud-boundary.md) | Open-source / Cloud boundary |
| [ADR-007](docs/adrs/adr-007-portability.md) | Portability requirement |
| [ADR-008](docs/adrs/adr-008-hub-neon-ownership.md) | Hub/Neon database ownership |
| [ADR-009](docs/adrs/adr-009-widget-isolation-and-origins.md) | Widget isolation (Shadow DOM) and origin policy |
| [ADR-010](docs/adrs/adr-010-channels-execution-and-deployment.md) | Channels, execution environments, and the Agent Runtime bundle |
| [ADR-011](docs/adrs/adr-011-agent-rate-limiting.md) | Agent rate limiting (requests/minute, messages/session, daily token ceiling) |
| [ADR-012](docs/adrs/adr-012-marketplace-hub-on-postgres.md) | Marketplace (Hub) catalog on Postgres via Drizzle |
| [ADR-013](docs/adrs/adr-013-larkup-proxy-boundary.md) | `larkup-proxy` stays a Knowledge Integration OAuth Proxy |
| [ADR-014](docs/adrs/adr-014-slack-channel.md) | Slack channel — the `url_verification` handshake boundary |

Read the relevant ADR before making changes that touch architectural boundaries.

## Extension Creation

To create a new tool, skill, or knowledge integration:

1. Read the extension manifest v2 spec in [ADR-003](docs/adrs/adr-003-extension-manifest-v2.md).
2. Create a new package under `packages/tools/` (for tools) or the appropriate directory.
3. Include a valid `tool.manifest.json` or manifest v2 file.
4. Add typed input/output schemas, permission declarations, and fixture tests.
5. **Do not edit `apps/web/app/api/chat/tools.ts`.** New tools register via manifest. The Agent Runtime discovers and loads them automatically.
6. Run `pnpm changeset` and document the new extension.

Thank you for contributing!
