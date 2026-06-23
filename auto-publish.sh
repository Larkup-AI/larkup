#!/bin/bash
set -e

echo "========================================="
echo "  Publishing LarkupRAG (NPM & Docker)   "
echo "========================================="

echo ""
echo "[1/2] Publishing to NPM..."
cd apps/web
npm publish --access public
cd ../..
echo "✅ NPM publish complete."

echo ""
echo "[2/2] Building and Pushing Docker Image..."
# Build the image
docker build -t aboneda/larkup-rag:latest -f docker/Dockerfile .
# Push the image to Docker Hub
docker push aboneda/larkup-rag:latest
echo "✅ Docker publish complete."

echo ""
echo "🎉 Successfully published to both NPM and Docker Hub!"
