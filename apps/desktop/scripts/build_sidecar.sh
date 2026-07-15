#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────
# Build the Next.js standalone server and package it into a
# platform-specific binary for the Tauri sidecar.
#
# Usage:
#   bash scripts/build_sidecar.sh
#
# Prerequisites:
#   - Node.js 20+
#   - pnpm
#   - Rust toolchain (for target-triple detection)
# ─────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(cd "$DESKTOP_DIR/../.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
BINARIES_DIR="$DESKTOP_DIR/src-tauri/binaries"

echo "╔══════════════════════════════════════════════╗"
echo "║        Larkup Desktop — Sidecar Build        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Prerequisite checks ──────────────────────────────────────────

command -v node >/dev/null 2>&1 || { echo "✗ Node.js is required but not installed."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "✗ pnpm is required but not installed."; exit 1; }
command -v rustc >/dev/null 2>&1 || { echo "✗ Rust is required but not installed."; exit 1; }

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "✗ Node.js 20+ is required (found v$(node -v))"
  exit 1
fi
echo "✓ Node.js $(node -v)"
echo "✓ pnpm $(pnpm -v)"

# ── Detect the host target triple ────────────────────────────────

TARGET_TRIPLE=$(rustc -Vv 2>/dev/null | grep '^host:' | awk '{print $2}')
if [ -z "$TARGET_TRIPLE" ]; then
  echo "✗ Could not detect target triple. Is rustc installed?"
  exit 1
fi
echo "✓ Target triple: $TARGET_TRIPLE"
echo ""

# ── Step 1: Build the Next.js app in standalone mode ─────────────

echo "▸ Building Next.js standalone..."
cd "$ROOT_DIR"
pnpm --filter larkup build

# Verify standalone output exists
STANDALONE_DIR="$WEB_DIR/.next/standalone"
if [ ! -d "$STANDALONE_DIR" ]; then
  echo "✗ Standalone output not found at $STANDALONE_DIR"
  echo "  Make sure next.config.mjs has output: 'standalone'"
  exit 1
fi
echo "✓ Standalone build complete"

# Copy static assets into standalone (Next.js standalone needs these)
cp -r "$WEB_DIR/.next/static" "$STANDALONE_DIR/apps/web/.next/static"
if [ -d "$WEB_DIR/public" ]; then
  cp -r "$WEB_DIR/public" "$STANDALONE_DIR/apps/web/public"
fi
echo "✓ Static assets copied"

# ── Step 2: Package into a single binary with @yao-pkg/pkg ──────

echo ""
echo "▸ Packaging with @yao-pkg/pkg..."

# Map Tauri target triple → Node target
NODE_VERSION="v20.14.0"
NODE_TARGET=""
EXT="tar.gz"

case "$TARGET_TRIPLE" in
  aarch64-apple-darwin)
    NODE_TARGET="darwin-arm64"
    ;;
  x86_64-apple-darwin)
    NODE_TARGET="darwin-x64"
    ;;
  x86_64-pc-windows-msvc)
    NODE_TARGET="win-x64"
    EXT="zip"
    ;;
  x86_64-unknown-linux-gnu)
    NODE_TARGET="linux-x64"
    ;;
  aarch64-unknown-linux-gnu)
    NODE_TARGET="linux-arm64"
    ;;
  *)
    echo "✗ Unsupported target triple: $TARGET_TRIPLE"
    exit 1
    ;;
esac

mkdir -p "$BINARIES_DIR"

# Binary name follows Tauri's sidecar naming convention
BINARY_NAME="larkup-server-$TARGET_TRIPLE"

if [[ "$TARGET_TRIPLE" == *"windows"* ]]; then
  BINARY_NAME="$BINARY_NAME.exe"
  URL="https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-$NODE_TARGET.zip"
  echo "  Downloading $URL..."
  curl -fsSL -o "$BINARIES_DIR/node.zip" "$URL"
  unzip -p "$BINARIES_DIR/node.zip" "node-$NODE_VERSION-$NODE_TARGET/node.exe" > "$BINARIES_DIR/$BINARY_NAME"
  rm "$BINARIES_DIR/node.zip"
else
  URL="https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-$NODE_TARGET.tar.gz"
  echo "  Downloading $URL..."
  curl -fsSL -o "$BINARIES_DIR/node.tar.gz" "$URL"
  tar -xzf "$BINARIES_DIR/node.tar.gz" -C "$BINARIES_DIR" "node-$NODE_VERSION-$NODE_TARGET/bin/node"
  mv "$BINARIES_DIR/node-$NODE_VERSION-$NODE_TARGET/bin/node" "$BINARIES_DIR/$BINARY_NAME"
  rm -rf "$BINARIES_DIR/node-$NODE_VERSION-$NODE_TARGET" "$BINARIES_DIR/node.tar.gz"
fi

chmod +x "$BINARIES_DIR/$BINARY_NAME"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✓ Sidecar binary ready                      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  Binary: $BINARIES_DIR/$BINARY_NAME"
echo "  Size:   $(du -h "$BINARIES_DIR/$BINARY_NAME" | cut -f1)"
echo ""
echo "  Next: cd $DESKTOP_DIR && pnpm build"
