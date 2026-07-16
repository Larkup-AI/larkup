#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PY_SDK_DIR="$ROOT_DIR/apps/sdk/py-sdk"
ENV_FILE="$ROOT_DIR/.env.dev"

echo "========================================="
echo "  Publishing Python SDK to PyPI          "
echo "========================================="

# Load PyPI token from .env.dev
if [ -f "$ENV_FILE" ]; then
    # Source the env file (handles KEY="value" format)
    set -a
    source "$ENV_FILE"
    set +a
    echo "✅ Loaded credentials from .env.dev"
else
    echo "⚠️  No .env.dev found. Checking environment variables..."
fi

if [ -z "$PYPI_TOKEN" ]; then
    echo "❌ PYPI_TOKEN is not set. Please set it in .env.dev or as an environment variable."
    exit 1
fi

cd "$PY_SDK_DIR"

# Clean previous builds
echo ""
echo "[1/3] Cleaning previous build artifacts..."
rm -rf dist build
find . -name '*.egg-info' -type d -exec rm -rf {} + 2>/dev/null || true

# Build the package
echo "[2/3] Building package..."
uv build

# Extract name and version from pyproject.toml
PKG_NAME=$(grep -E '^name\s*=\s*' pyproject.toml | cut -d '"' -f 2 | head -n 1)
PKG_VERSION=$(grep -E '^version\s*=\s*' pyproject.toml | cut -d '"' -f 2 | head -n 1)

# Check if version exists on PyPI
if pip index versions "$PKG_NAME" 2>/dev/null | grep -q "$PKG_VERSION"; then
  echo "⚠️  $PKG_NAME@$PKG_VERSION is already published to PyPI. Skipping."
else
  # Publish to PyPI
  echo "[3/3] Publishing to PyPI..."
  uv publish --token "$PYPI_TOKEN"
fi

echo ""
echo "✅ Successfully published larkup to PyPI!"
echo "   View at: https://pypi.org/project/larkup/"
