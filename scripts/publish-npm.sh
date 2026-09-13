#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

require_clean_tree() {
  if [ -n "$(git status --porcelain)" ]; then
    echo "Refusing to publish npm packages from a dirty worktree." >&2
    echo "Commit the release version changes first." >&2
    exit 1
  fi
}

require_command git
require_command npm
require_command pnpm
require_clean_tree

echo "Checking npm authentication..."
NPM_USER="$(npm whoami)"
echo "Authenticated to npm as ${NPM_USER}."

echo "Building npm release targets..."
pnpm --filter @larkup/integrations build
pnpm --filter @larkup/sandbox build
pnpm --filter @larkup/tool-doc-editor build
pnpm --filter @larkup/tool-video-audio build
pnpm --filter @larkup/tool-video-intelligence build
pnpm --filter @larkup/sdk build
pnpm --filter @larkup/cli build
# The npm package ships Next's standalone output. Rebuild it from scratch so a
# previous release's traced bundle is never republished with a new outer version.
rm -rf apps/web/.next
pnpm --filter larkup build

echo "Publishing versioned workspace packages through Changesets..."
pnpm changeset publish

echo "npm publishing completed."
