#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DOCKER_IMAGE="aboneda/larkup-rag"
DOCKER_TAG="${1:-latest}"

echo "========================================="
echo "  Publishing Docker Image                "
echo "========================================="

cd "$ROOT_DIR"

echo ""
echo "[1/2] Building Docker image: $DOCKER_IMAGE:$DOCKER_TAG..."
docker build -t "$DOCKER_IMAGE:$DOCKER_TAG" -f docker/Dockerfile .

echo ""
echo "[2/2] Pushing Docker image..."
docker push "$DOCKER_IMAGE:$DOCKER_TAG"

echo ""
echo "✅ Docker image published: $DOCKER_IMAGE:$DOCKER_TAG"
