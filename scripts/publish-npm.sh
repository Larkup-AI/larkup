#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "========================================="
echo "  Publishing NPM Packages               "
echo "========================================="

# Build only publishable packages
echo ""
echo "[0/3] Building publishable packages..."

echo "  Building JS SDK..."
cd "$ROOT_DIR/apps/sdk/js-sdk"
pnpm build

echo "  Building CLI..."
cd "$ROOT_DIR/apps/cli"
pnpm build

echo "  Building Web..."
cd "$ROOT_DIR/apps/web"
pnpm build

# --- 1. JS SDK ---
echo ""
echo "[1/3] Publishing @larkup/sdk..."
cd "$ROOT_DIR/apps/sdk/js-sdk"
npm publish --access public
echo "✅ @larkup/sdk published."

# --- 2. CLI ---
echo ""
echo "[2/3] Publishing @larkup/cli..."
cd "$ROOT_DIR/apps/cli"
npm publish --access public
echo "✅ @larkup/cli published."

# --- 3. Web (larkup) ---
echo ""
echo "[3/3] Publishing larkup (web)..."
cd "$ROOT_DIR/apps/web"
npm publish --access public
echo "✅ larkup (web) published."

echo ""
echo "========================================="
echo "🎉 All NPM packages published!"
echo "========================================="
echo "  - @larkup/sdk"
echo "  - @larkup/cli"
echo "  - larkup"
