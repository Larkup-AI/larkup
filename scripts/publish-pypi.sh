#!/bin/bash
set -e

#===========================================
# Publish Python SDK (larkup-rag) to PyPI
#===========================================

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

# Publish to PyPI
echo "[3/3] Publishing to PyPI..."
uv publish --token "$PYPI_TOKEN"

echo ""
echo "✅ Successfully published larkup-rag to PyPI!"
echo "   View at: https://pypi.org/project/larkup-rag/"
