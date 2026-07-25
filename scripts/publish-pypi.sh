#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY_SDK_DIR="$REPO_ROOT/apps/sdk/py-sdk"
ENV_FILE="$REPO_ROOT/.env.dev"

if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  echo "Refusing to publish PyPI from a dirty worktree." >&2
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ -z "${PYPI_TOKEN:-}" ]; then
  echo "PYPI_TOKEN is not set in the environment or .env.dev." >&2
  exit 1
fi

command -v curl >/dev/null 2>&1 || {
  echo "curl is required." >&2
  exit 1
}
command -v uv >/dev/null 2>&1 || {
  echo "uv is required." >&2
  exit 1
}

cd "$PY_SDK_DIR"
PKG_NAME="$(sed -n 's/^name = \"\\([^\"]*\\)\"/\\1/p' pyproject.toml)"
PKG_VERSION="$(sed -n 's/^version = \"\\([^\"]*\\)\"/\\1/p' pyproject.toml)"

if curl --fail --silent --show-error \
  "https://pypi.org/pypi/${PKG_NAME}/${PKG_VERSION}/json" >/dev/null 2>&1; then
  echo "${PKG_NAME} ${PKG_VERSION} is already published to PyPI; skipping."
  exit 0
fi

echo "Building ${PKG_NAME} ${PKG_VERSION}..."
rm -rf "$PY_SDK_DIR/dist" "$PY_SDK_DIR/build"
find "$PY_SDK_DIR" -maxdepth 1 -name '*.egg-info' -type d -exec rm -rf {} +
uv build

echo "Publishing ${PKG_NAME} ${PKG_VERSION} to PyPI..."
uv publish --token "$PYPI_TOKEN"

curl --fail --silent --show-error \
  "https://pypi.org/pypi/${PKG_NAME}/${PKG_VERSION}/json" >/dev/null
echo "Verified ${PKG_NAME} ${PKG_VERSION} on PyPI."
