#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "========================================="
echo "  Publishing NPM Packages               "
echo "========================================="

# Build only publishable packages
echo ""
echo "[0/6] Building publishable packages..."

echo "  Building JS SDK..."
cd "$ROOT_DIR/apps/sdk/js-sdk"
pnpm build

echo "  Building CLI..."
cd "$ROOT_DIR/apps/cli"
pnpm build

echo "  Building Web..."
cd "$ROOT_DIR/apps/web"
pnpm build

# --- 1. vector-stores ---
echo ""
echo "[1/6] Publishing @larkup/vector-stores..."
cd "$ROOT_DIR/packages/vector-stores"
pnpm publish --access public --no-git-checks
echo "✅ @larkup/vector-stores published."

# --- 2. scraper ---
echo ""
echo "[2/6] Publishing @larkup/scraper..."
cd "$ROOT_DIR/packages/scraper"
pnpm publish --access public --no-git-checks
echo "✅ @larkup/scraper published."

# --- 3. core ---
echo ""
echo "[3/6] Publishing @larkup/core..."
cd "$ROOT_DIR/packages/core"
pnpm publish --access public --no-git-checks
echo "✅ @larkup/core published."

# --- 4. JS SDK ---
echo ""
echo "[4/6] Publishing @larkup/sdk..."
cd "$ROOT_DIR/apps/sdk/js-sdk"
pnpm publish --access public --no-git-checks
echo "✅ @larkup/sdk published."

# --- 5. CLI ---
echo ""
echo "[5/6] Publishing @larkup/cli..."
cd "$ROOT_DIR/apps/cli"
pnpm publish --access public --no-git-checks
echo "✅ @larkup/cli published."

# --- 6. Web (larkup) ---
echo ""
echo "[6/6] Publishing larkup (web)..."
cd "$ROOT_DIR/apps/web"
pnpm publish --access public --no-git-checks
echo "✅ larkup (web) published."

echo ""
echo "========================================="
echo "🎉 All NPM packages published!"
echo "========================================="
echo "  - @larkup/sdk"
echo "  - @larkup/cli"
echo "  - larkup"
