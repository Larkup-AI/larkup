#!/usr/bin/env bash

set -e

files=(
  "Dockerfile"
  "docker-compose.yaml"
  ".dockerignore"
  "entrypoint.sh"
  "apps/web/next.config.ts"
  "rebuild.sh"
)

copy_to_clipboard() {
  if command -v pbcopy >/dev/null 2>&1; then
    pbcopy
  elif command -v xclip >/dev/null 2>&1; then
    xclip -selection clipboard
  elif command -v wl-copy >/dev/null 2>&1; then
    wl-copy
  else
    echo "❌ No clipboard utility found (pbcopy, xclip, wl-copy)" >&2
    exit 1
  fi
}

{
  for file in "${files[@]}"; do
    echo "$file"
    echo "content"
    echo "---"
    cat "$file"
    echo
    echo "=============================="
    echo
  done
} | copy_to_clipboard

echo "✅ Files copied to clipboard"