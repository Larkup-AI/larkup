#!/usr/bin/env bash
set -e

echo "🚀 Starting larkup monorepo..."

# Ensure we are in the root directory
cd "$(dirname "$0")/.."

# Check if docker-compose or docker compose is available
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker compose"
else
    echo "❌ Docker Compose is not installed."
    exit 1
fi

echo "Building and starting containers using $DOCKER_COMPOSE_CMD..."
$DOCKER_COMPOSE_CMD -f docker/docker-compose.dev.yml up --build -d

echo "✅ Containers started successfully! The app is running on http://localhost:3000"
echo "To view logs, run: $DOCKER_COMPOSE_CMD -f docker/docker-compose.dev.yml logs -f web"
echo "To stop the app, run: $DOCKER_COMPOSE_CMD -f docker/docker-compose.dev.yml down"
