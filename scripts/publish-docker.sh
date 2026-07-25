#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DOCKER_IMAGE="${DOCKER_IMAGE:-aboneda/larkup}"
DOCKER_PLATFORMS="${DOCKER_PLATFORMS:-linux/amd64,linux/arm64}"
WEB_VERSION="$(node -p "require('./apps/web/package.json').version")"
DOCKER_TAG="${1:-$WEB_VERSION}"

if ! [[ "$DOCKER_TAG" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Docker tag must be an exact release version, received: $DOCKER_TAG" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to publish Docker from a dirty worktree." >&2
  exit 1
fi

docker info >/dev/null
docker buildx inspect >/dev/null

echo "Building and pushing ${DOCKER_IMAGE}:${DOCKER_TAG} and ${DOCKER_IMAGE}:latest..."
docker buildx build \
  --platform "$DOCKER_PLATFORMS" \
  --build-arg NEXT_PUBLIC_DOCKER_ENV=true \
  --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" \
  --label "org.opencontainers.image.version=$DOCKER_TAG" \
  --tag "$DOCKER_IMAGE:$DOCKER_TAG" \
  --tag "$DOCKER_IMAGE:latest" \
  --push \
  -f docker/Dockerfile \
  .

echo "Verifying Docker manifests..."
docker buildx imagetools inspect "$DOCKER_IMAGE:$DOCKER_TAG" >/dev/null
docker buildx imagetools inspect "$DOCKER_IMAGE:latest" >/dev/null
echo "Docker publishing completed for ${DOCKER_IMAGE}:${DOCKER_TAG}."
