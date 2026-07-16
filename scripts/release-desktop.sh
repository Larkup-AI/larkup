#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════
# Larkup — Launch Desktop Release
# ═══════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "═══════════════════════════════════════════"
echo "  Launch New Desktop Release"
echo "═══════════════════════════════════════════"
echo ""

# 1. Get the version
VERSION=$1

if [ -z "$VERSION" ]; then
    read -p "Enter new version (e.g., 0.2.0): " VERSION
fi

# Remove leading 'v' if user typed it
VERSION=${VERSION#v}

if [ -z "$VERSION" ]; then
    echo "✗ Version cannot be empty."
    exit 1
fi

echo "▸ Bumping version to $VERSION..."

# 2. Update package.json version
node -e "
const fs = require('fs');
const pkgPath = '$ROOT_DIR/apps/desktop/package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath));
pkg.version = '$VERSION';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
"

# 3. Update tauri.conf.json version
node -e "
const fs = require('fs');
const tauriPath = '$ROOT_DIR/apps/desktop/src-tauri/tauri.conf.json';
const tauri = JSON.parse(fs.readFileSync(tauriPath));
tauri.version = '$VERSION';
fs.writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + '\n');
"

echo "✓ Updated apps/desktop/package.json"
echo "✓ Updated apps/desktop/src-tauri/tauri.conf.json"
echo ""

# 4. Commit and Tag
cd "$ROOT_DIR"

echo "▸ Committing version bump..."
git add apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json
git commit -m "chore: bump desktop version to $VERSION"

echo "▸ Tagging release as desktop-v$VERSION..."
git tag "desktop-v$VERSION"

echo "▸ Pushing to GitHub..."
git push origin main
git push origin "desktop-v$VERSION"

echo ""
echo "🎉 Successfully launched desktop release!"
echo "GitHub Actions is now building and publishing the desktop app in the background."
echo "You can check the progress at: https://github.com/Larkup-AI/larkup/actions"
