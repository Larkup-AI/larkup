#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$REPO_ROOT/scripts"
cd "$REPO_ROOT"

PUBLISH_NPM=true
PUBLISH_PYPI=true
PUBLISH_DOCKER=false
PUBLISH_DESKTOP=false

usage() {
  cat <<'USAGE'
Usage: scripts/auto-publish.sh [options]

  --all             Publish npm, PyPI, and Docker artifacts
  --npm-only        Publish only versioned npm packages
  --pypi-only       Publish only the Python SDK
  --docker-only     Publish only the versioned Docker image and latest tag
  --with-docker     Add Docker to the default npm + PyPI release
  --with-desktop    Trigger the desktop release workflow after package publishing
  --skip-pypi       Exclude the Python SDK
  --help            Show this help

Versions must already be prepared and committed. Use `pnpm changeset version`;
do not edit npm versions manually.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --all | --with-docker)
      PUBLISH_DOCKER=true
      ;;
    --npm-only)
      PUBLISH_NPM=true
      PUBLISH_PYPI=false
      PUBLISH_DOCKER=false
      PUBLISH_DESKTOP=false
      ;;
    --pypi-only)
      PUBLISH_NPM=false
      PUBLISH_PYPI=true
      PUBLISH_DOCKER=false
      PUBLISH_DESKTOP=false
      ;;
    --docker-only)
      PUBLISH_NPM=false
      PUBLISH_PYPI=false
      PUBLISH_DOCKER=true
      PUBLISH_DESKTOP=false
      ;;
    --with-desktop | --desktop)
      PUBLISH_DESKTOP=true
      ;;
    --skip-pypi)
      PUBLISH_PYPI=false
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to publish from a dirty worktree." >&2
  echo "Commit and push the tested source and release version changes first." >&2
  exit 1
fi

WEB_VERSION="$(node -p "require('./apps/web/package.json').version")"
PYPI_VERSION="$(sed -n 's/^version = "\([^"]*\)"/\1/p' apps/sdk/py-sdk/pyproject.toml)"

if [ "$PUBLISH_PYPI" = true ] && [ "$WEB_VERSION" != "$PYPI_VERSION" ]; then
  echo "Version mismatch: larkup npm is ${WEB_VERSION}, Python SDK is ${PYPI_VERSION}." >&2
  echo "Synchronize and commit the Python SDK version before publishing." >&2
  exit 1
fi

echo "Publishing Larkup release ${WEB_VERSION}:"
echo "  npm:     ${PUBLISH_NPM}"
echo "  PyPI:    ${PUBLISH_PYPI}"
echo "  Docker:  ${PUBLISH_DOCKER}"
echo "  Desktop: ${PUBLISH_DESKTOP}"

if [ "$PUBLISH_NPM" = true ]; then
  "$SCRIPTS_DIR/publish-npm.sh"
fi

if [ "$PUBLISH_PYPI" = true ]; then
  "$SCRIPTS_DIR/publish-pypi.sh"
fi

if [ "$PUBLISH_DOCKER" = true ]; then
  "$SCRIPTS_DIR/publish-docker.sh" "$WEB_VERSION"
fi

if [ "$PUBLISH_DESKTOP" = true ]; then
  command -v gh >/dev/null 2>&1 || {
    echo "GitHub CLI is required for --with-desktop." >&2
    exit 1
  }
  gh workflow run desktop-release.yml -f "version=${WEB_VERSION}"
fi

echo "Release ${WEB_VERSION} publishing completed."
