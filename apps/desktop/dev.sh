#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────
# Larkup Desktop — Local Development
#
# One-command script to run the desktop app locally.
#
# Usage:
#   bash apps/desktop/dev.sh          # from repo root
#   bash dev.sh                       # from apps/desktop/
#
# What it does:
#   1. Checks prerequisites (Rust, Node.js 20+, pnpm)
#   2. Installs dependencies (pnpm install)
#   3. Builds the sidecar binary (if not already built)
#   4. Launches Tauri in dev mode
# ─────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$SCRIPT_DIR"
ROOT_DIR="$(cd "$DESKTOP_DIR/../.." && pwd)"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║       Larkup Desktop — Dev Environment       ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Prerequisite checks ──────────────────────────────────────────

HAS_ERROR=0

check_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "  ✓ $1 $(eval "$2" 2>/dev/null || echo "")"
  else
    echo "  ✗ $1 is not installed"
    HAS_ERROR=1
  fi
}

echo "Checking prerequisites..."
check_cmd "node" "node -v"
check_cmd "pnpm" "pnpm -v"
check_cmd "rustc" "rustc --version | awk '{print \$2}'"
check_cmd "cargo" "cargo --version | awk '{print \$2}'"
echo ""

if [ "$HAS_ERROR" -eq 1 ]; then
  echo "Please install the missing tools and try again."
  echo ""
  echo "  Node.js 20+:  https://nodejs.org"
  echo "  pnpm:         npm install -g pnpm"
  echo "  Rust:         https://rustup.rs"
  echo ""
  exit 1
fi

# Check Node.js version
NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "✗ Node.js 20+ is required (found $(node -v))"
  exit 1
fi

# ── Install dependencies ─────────────────────────────────────────

echo "▸ Installing dependencies..."
cd "$ROOT_DIR"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
echo ""

# ── Build sidecar (if not already built) ─────────────────────────

TARGET_TRIPLE=$(rustc -Vv 2>/dev/null | grep '^host:' | awk '{print $2}')
BINARY_NAME="larkup-server-$TARGET_TRIPLE"
BINARY_PATH="$DESKTOP_DIR/src-tauri/binaries/$BINARY_NAME"

if [ -f "$BINARY_PATH" ]; then
  echo "✓ Sidecar binary already exists: $BINARY_NAME"
  echo "  (delete $BINARY_PATH to force a rebuild)"
else
  echo "▸ Building sidecar binary (this may take a few minutes)..."
  bash "$DESKTOP_DIR/scripts/build_sidecar.sh"
fi
echo ""

# ── Launch Tauri dev mode ─────────────────────────────────────────

echo "▸ Starting Tauri dev mode..."
echo "  The desktop app window will open shortly."
echo ""
cd "$DESKTOP_DIR"
pnpm start