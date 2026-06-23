#!/bin/bash

echo "Starting Larkup-RAG in production mode..."

# Check if pnpm is installed, install if missing
if ! command -v pnpm &> /dev/null; then
    echo "pnpm is not installed. Installing pnpm globally..."
    npm install -g pnpm
fi

echo "Installing dependencies..."
pnpm install

echo "Building the project..."
pnpm run build

echo "Starting the application..."
pnpm run start
