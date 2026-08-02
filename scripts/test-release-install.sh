#!/usr/bin/env bash
set -euo pipefail

# Performs the same first-time install a customer performs, but keeps npm,
# Larkup data, and shell configuration in a disposable directory. CI runs this
# on native Linux and macOS runners; Docker is intentionally not used here.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGE_VERSION="${LARKUP_INSTALL_VERSION:-latest}"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/larkup-release-install.XXXXXX")"
SERVER_PID=""

cleanup() {
  local code=$?
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEST_ROOT"
  exit "$code"
}
trap cleanup EXIT INT TERM

export HOME="$TEST_ROOT/home"
export NPM_CONFIG_CACHE="$TEST_ROOT/npm-cache"
export NPM_CONFIG_PREFIX="$TEST_ROOT/npm-prefix"
mkdir -p "$HOME" "$NPM_CONFIG_CACHE" "$NPM_CONFIG_PREFIX/bin" "$NPM_CONFIG_PREFIX/lib"

echo "Installing larkup@${PACKAGE_VERSION} using the checked-in installer..."
bash "$PROJECT_ROOT/scripts/install.sh" \
  --no-prompt \
  --no-start \
  --version "$PACKAGE_VERSION"

export PATH="$NPM_CONFIG_PREFIX/bin:$HOME/.npm-global/bin:$PATH"
command -v larkup
larkup --version

# The installed package must serve an HTTP response, not merely expose a shim.
PORT=4568 larkup start >"$TEST_ROOT/larkup.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl --fail --silent --show-error "http://127.0.0.1:4568/api/servers" >/dev/null; then
    echo "Installed Larkup server is healthy."
    exit 0
  fi
  sleep 1
done

echo "Installed Larkup server did not become healthy. Log follows:" >&2
tail -n 100 "$TEST_ROOT/larkup.log" >&2 || true
exit 1
