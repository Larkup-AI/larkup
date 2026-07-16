#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════
# Larkup — Publish Desktop Releases to UploadThing
# ═══════════════════════════════════════════════════════════════
#
# Usage:
#   ./scripts/publish-desktop.sh --dir ./release-assets
#   ./scripts/publish-desktop.sh --dir ./release-assets --version 0.2.0
#   ./scripts/publish-desktop.sh --dir ./release-assets --dry-run
#
# Environment:
#   UPLOADTHING_TOKEN — required (unless --dry-run)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo "═══════════════════════════════════════════"
echo "  Larkup — Publish Desktop Releases"
echo "═══════════════════════════════════════════"
echo ""

# ── Check prerequisites ──────────────────────────────────────

if ! command -v node &>/dev/null; then
    echo "✗ Node.js is required but not installed."
    exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "✗ Node.js 18+ is required (found $(node -v))"
    exit 1
fi
echo "✓ Node.js $(node -v)"

# Check for UPLOADTHING_TOKEN
DRY_RUN=false
for arg in "$@"; do
    if [ "$arg" = "--dry-run" ]; then
        DRY_RUN=true
    fi
done

if [ "$DRY_RUN" = false ] && [ -z "$UPLOADTHING_TOKEN" ]; then
    # Try to load from .env
    if [ -f "$ROOT_DIR/.env" ]; then
        export $(grep -v '^#' "$ROOT_DIR/.env" | grep UPLOADTHING_TOKEN | xargs)
    fi

    if [ -z "$UPLOADTHING_TOKEN" ]; then
        echo "✗ UPLOADTHING_TOKEN is not set"
        echo "  Set it as an environment variable or in .env"
        exit 1
    fi
fi
echo "✓ UPLOADTHING_TOKEN configured"
echo ""

# ── Install uploadthing if needed ────────────────────────────

if ! node -e "require('uploadthing/server')" 2>/dev/null; then
    echo "▸ Installing uploadthing..."
    cd "$ROOT_DIR"
    npm install --no-save uploadthing 2>/dev/null || pnpm add -w --save-peer uploadthing 2>/dev/null
    echo ""
fi

# ── Run the upload script ────────────────────────────────────

cd "$ROOT_DIR"
node "$SCRIPT_DIR/upload-desktop-releases.mjs" "$@"
