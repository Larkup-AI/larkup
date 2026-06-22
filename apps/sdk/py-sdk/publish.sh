#!/bin/bash
set -e

echo "Building larkup-rag..."
# Ensure the dist folder is clean before building
rm -rf dist
uv build

echo "Publishing to PyPI..."

# Publish to PyPI 
uv publish

echo "Successfully published larkup-rag!"
