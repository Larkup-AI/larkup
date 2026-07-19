# Contributing to Larkup

Welcome to the Larkup contributing guide! We appreciate any and all contributions.

There are many ways to contribute to Larkup:

- Report bugs and suggest features via GitHub Issues.
- Fix bugs and implement features (see our open issues to get started).
- Improve documentation and expand test coverage.

## Local Development

Larkup is a monorepo utilizing [pnpm](https://pnpm.io/) and [Turborepo](https://turbo.build/).

### Setup Instructions

1. Make sure you have Node.js installed (v20+ recommended). We use `.nvmrc` to specify the exact version.
2. Install `pnpm` globally if you haven't already: `npm install -g pnpm`.
3. Install dependencies by running `pnpm install` in the root folder.
4. (Optional) Boot required infrastructure using Docker: `cd docker && docker compose -f docker-compose.dev.yml up -d`.
5. Start the development server across all packages and apps:
   ```bash
   pnpm run dev
   ```
6. The primary web app usually runs on `http://localhost:3000` (refer to terminal output for specifics).

### Linting and Formatting

We enforce code quality and formatting through Husky hooks and lint-staged.
- **Formatting**: We use Prettier. Code is automatically formatted on commit.
- **Linting**: We use ESLint. You can run `pnpm lint` to check for issues.

## Commits & Pull Requests

1. **Branch Naming**: Use descriptive branch names (e.g., `feat/add-new-dashboard` or `fix/header-alignment`). If you have a ticket tracking system, prefix with the ticket ID.
2. **Versioning with Changesets**: Since Larkup is a monorepo, we use [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs.
   - If your PR introduces user-facing changes or modifies packages, run `pnpm changeset` and follow the prompts.
   - Commit the generated `.md` file inside the `.changeset` directory along with your code.
3. **Commit Messages**: We recommend following [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat: added analytics tracking`, `fix: resolved navigation bug`). We have `commitlint` configured.
4. **Pull Requests**:
   - Keep pull requests focused and small.
   - Fill out the provided PR template.
   - Ensure CI checks (lint, build, test) pass before requesting a review.

## Architecture Overview

Refer to `.agents/skills/architecture-overview/SKILL.md` for a high-level overview of the monorepo structure, package responsibilities, and core technologies.

Thank you for contributing!
