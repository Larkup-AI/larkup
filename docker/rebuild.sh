#!/bin/bash
set -e

echo "🔨 Building packages locally to avoid Docker memory issues..."

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf apps/web/.next
rm -rf packages/db/dist
rm -rf packages/ai/dist
rm -rf apps/api/dist

# Build packages locally first
echo "📦 Building @gaia/db..."
cd packages/db
pnpm run build
cd ../..

echo "🤖 Building @gaia/ai..."
cd packages/ai
pnpm run build
cd ../..

echo "🔌 Building @gaia/api..."
cd apps/api
pnpm run build
cd ../..

echo "🌐 Building Next.js app locally with standalone output..."
cd apps/web

# Set environment variables for standalone build
export DOCKER_BUILD=true
export NODE_ENV=production

# INCREASE MEMORY for the build process
export NODE_OPTIONS="--max-old-space-size=8192"

echo "Building with increased memory (8GB)..."
pnpm run build

# Verify standalone output exists
if [ ! -d ".next/standalone" ]; then
    echo "❌ Error: .next/standalone directory not found!"
    echo "Make sure your next.config.ts has output: 'standalone'"
    exit 1
fi

echo "✅ Standalone output verified at apps/web/.next/standalone"

# List what was built
echo "📦 Build output:"
ls -lh .next/standalone

cd ../..

echo "✅ All builds complete!"
echo "🐳 Now building Docker image (just copying built files)..."

# Now build Docker with pre-built artifacts
DOCKER_BUILDKIT=1 docker-compose build # --no-cache

echo "🎉 Docker build complete!"
echo "🚀 To start the container, run: docker-compose up -d"