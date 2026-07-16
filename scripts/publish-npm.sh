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

publish_package() {
  local dir="$1"
  cd "$ROOT_DIR/$dir"
  
  local pkg_name=$(node -p "require('./package.json').name")
  local pkg_version=$(node -p "require('./package.json').version")
  
  # Try to get the published version from the registry
  if npm view "$pkg_name@$pkg_version" version &>/dev/null; then
    echo "⚠️  $pkg_name@$pkg_version is already published. Skipping."
  else
    echo "🚀 Publishing $pkg_name@$pkg_version..."
    pnpm publish --access public --no-git-checks
    echo "✅ $pkg_name published."
  fi
}

# --- 1. vector-stores ---
echo ""
echo "[1/6] Checking @larkup/vector-stores..."
publish_package "packages/vector-stores"

# --- 2. scraper ---
echo ""
echo "[2/6] Checking @larkup/scraper..."
publish_package "packages/scraper"

# --- 3. core ---
echo ""
echo "[3/6] Checking @larkup/core..."
publish_package "packages/core"

# --- 4. JS SDK ---
echo ""
echo "[4/6] Checking @larkup/sdk..."
publish_package "apps/sdk/js-sdk"

# --- 5. CLI ---
echo ""
echo "[5/6] Checking @larkup/cli..."
publish_package "apps/cli"

# --- 6. Web (larkup) ---
echo ""
echo "[6/6] Checking larkup (web)..."
publish_package "apps/web"

echo ""
echo "========================================="
echo "🎉 All NPM packages published!"
echo "========================================="
echo "  - @larkup/sdk"
echo "  - @larkup/cli"
echo "  - larkup"
