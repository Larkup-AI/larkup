# Contributing to Larkup

Welcome to the Larkup contributing guide! We appreciate any and all contributions.

There are many ways to contribute to Larkup:

- Report bugs and suggest features via GitHub Issues.
- Fix bugs and implement features (see our open issues to get started).
- Improve documentation and expand test coverage.
- Add support for new data sources and file types.

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
7. The web app runs on `http://localhost:4567`. RAG servers launched from **Settings → Server** use ports `8080` to `8090`.

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

| Package                          | Area         | Description                                                        |
| -------------------------------- | ------------ | ------------------------------------------------------------------ |
| `larkup` (`apps/web`)            | Web app      | Next.js web UI and API routes                                      |
| `@larkup/cli`                    | CLI          | Command-line interface                                             |
| `@larkup/sdk`                    | SDK          | TypeScript SDK client (`apps/sdk/js-sdk`)                          |
| `apps/sdk/py-sdk`                | SDK          | Python SDK client                                                  |
| `@larkup/core`                   | Core         | Config store, document store, indexer, embedder, server generation |
| `@larkup/workspace-server`       | Core         | Shared chat route, prompts, and tool registry                      |
| `@larkup/workspace-app`          | Core         | Shared workspace application logic                                 |
| `@larkup/workspace-ui`           | Core         | Shared workspace UI components                                     |
| `@larkup/vector-stores`          | Core         | Vector database adapters (LanceDB, Pinecone, etc.)                 |
| `@larkup/scraper`                | Core         | Web scraping and crawling                                          |
| `@larkup/integrations`           | Data sources | Third-party data source integrations                               |
| `@larkup/sandbox`                | Security     | Sandboxed code execution                                           |
| `@larkup/tool-video-intelligence`| Tools        | Video intelligence (experimental)                                  |
| `@larkup/proxy`                  | Integrations | OAuth proxy for data source integrations                           |

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
- `apps/marketplace/.env: DATABASE_URL` → Marketplace-only database. See [ADR-008](docs/adrs/adr-008-hub-neon-ownership.md).
- Root `.env: DATABASE_URL` → Reserved for future Cloud control plane. See [ADR-008](docs/adrs/adr-008-hub-neon-ownership.md).
- Use descriptive placeholder values in `.env.example` files (e.g., `YOUR_API_KEY_HERE`).

## Marketplace: local Postgres, no Neon account needed

`apps/marketplace`'s catalog uses Postgres through `packages/marketplace/src/db`.
Use the local connection below; no Neon credential is needed:

```bash
docker compose -f docker/marketplace-db.yml up -d
cp packages/marketplace/.env.example packages/marketplace/.env
pnpm --filter @larkup/marketplace db:migrate
pnpm --filter @larkup/marketplace db:seed
pnpm --filter @larkup/marketplace db:test
pnpm --filter @larkup/hub test
pnpm --filter @larkup/hub dev
```

Schema changes go in `packages/marketplace/src/db/schema/*.ts`. Run
`pnpm --filter @larkup/marketplace db:generate` and commit the migration in
`packages/marketplace/db/drizzle/`. Marketplace queries live in
`packages/marketplace/src/db/repo.ts`.

PR previews that touch the Hub use Neon branching instead of this container —
see the TASK 03 card in `plan.md` §15 for the branch-per-PR flow. That needs
`NEON_API_KEY`/CI secrets a maintainer provisions separately; it is not part
of the local contributor path above.

## Architecture Overview

Refer to `.agents/skills/architecture-overview/SKILL.md` for a high-level overview of the monorepo structure, package responsibilities, and core technologies.

### Architecture Decision Records

Key architectural decisions are documented in `docs/adrs/`:

| ADR                                                               | Decision                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [ADR-001](docs/adrs/adr-001-knowledge-vs-agent.md)                | Knowledge Server vs Agent boundary                                           |
| [ADR-002](docs/adrs/adr-002-agent-releases.md)                    | Immutable Agent Releases                                                     |
| [ADR-003](docs/adrs/adr-003-extension-manifest-v2.md)             | Extension manifest v2 and four kinds                                         |
| [ADR-004](docs/adrs/adr-004-key-model.md)                         | Scoped key model                                                             |
| [ADR-005](docs/adrs/adr-005-output-blocks.md)                     | Generic output blocks                                                        |
| [ADR-006](docs/adrs/adr-006-oss-cloud-boundary.md)                | Open-source / Cloud boundary                                                 |
| [ADR-007](docs/adrs/adr-007-portability.md)                       | Portability requirement                                                      |
| [ADR-008](docs/adrs/adr-008-hub-neon-ownership.md)                | Hub/Neon database ownership                                                  |
| [ADR-009](docs/adrs/adr-009-widget-isolation-and-origins.md)      | Widget isolation (Shadow DOM) and origin policy                              |
| [ADR-010](docs/adrs/adr-010-channels-execution-and-deployment.md) | Channels, execution environments, and the Agent Runtime bundle               |
| [ADR-011](docs/adrs/adr-011-agent-rate-limiting.md)               | Agent rate limiting (requests/minute, messages/session, daily token ceiling) |
| [ADR-012](docs/adrs/adr-012-marketplace-hub-on-postgres.md)       | Marketplace (Hub) catalog on Postgres via Drizzle                            |
| [ADR-013](docs/adrs/adr-013-larkup-proxy-boundary.md)             | `larkup-proxy` stays a Knowledge Integration OAuth Proxy                     |
| [ADR-014](docs/adrs/adr-014-slack-channel.md)                     | Slack channel — the `url_verification` handshake boundary                    |

Read the relevant ADR before making changes that touch architectural boundaries.

## Extension Creation

To create a new tool, skill, or knowledge integration:

1. Read the extension manifest v2 spec in [ADR-003](docs/adrs/adr-003-extension-manifest-v2.md).
2. Create a new package under `packages/marketplace-tools/` (for tools) or the appropriate directory.
3. Include a valid `tool.manifest.json` or manifest v2 file.
4. Add typed input/output schemas, permission declarations, and fixture tests.
5. **Do not edit `apps/web/app/api/chat/tools.ts`.** New tools register via manifest. The Agent Runtime discovers and loads them automatically.
6. Run `pnpm changeset` and document the new extension.

Thank you for contributing!
