---
name: architecture-overview
description: High-level overview of the Larkup monorepo architecture, packages, and core technologies. Use this when starting complex tasks or refactoring to understand where code should live.
tags: architecture, monorepo, nextjs, core
---

# Larkup Architecture Overview

## Overview

Larkup is an open-source Custom AI infrastructure project allowing users to ingest, index, and deploy production-ready vector search APIs in minutes. It is structured as a monorepo using `pnpm` workspaces and Turborepo.

## Package Dependency Layers

1. **Core Packages**:
   - `@larkup/core`: The central brain of the system. Contains logical stores (`config-store`, `documents-store`, `index-store`, `analytics-store`, `media-store`), indexing logic (`indexer`, `embedder`, `chunker`), and code generation for the custom AI server (`generate-server`).
   - `@larkup/vector-stores`: Connectors to various vector databases (LanceDB, Pinecone, Chroma, etc.).
   - `@larkup/scraper`: Utilities to scrape URLs and extract text for ingestion.
   - `@larkup/marketplace`: Plugin/tool system — registry, installer, loader, and storage provider abstraction. Powers the Marketplace hub in settings.
   - `@larkup/sandbox` & `@larkup/ee`: Sandboxing and enterprise features.

2. **Marketplace Tools** (`packages/tools/`):
   - `@larkup/tool-video-audio`: Installable tool for video/audio processing (ffmpeg, transcription, frame extraction).
   - `@larkup/tool-clip-embeddings`: Placeholder for future CLIP/SigLIP image similarity search.

3. **Applications**:
   - `apps/web`: A Next.js application that serves as the main Web UI (Dashboard) and API server. It configures pipelines, ingests data, and deploys the generated custom AI servers. Uses Vercel AI SDK heavily.
   - `apps/hub`: The Larkup Hub API — marketplace catalog, tool install tracking, and CI publish webhook. Hono on Vercel. Serves `/v1/tools` endpoints for remote tool discovery.
   - `apps/cli`: A command-line interface (`@larkup/cli`) to initialize, index, and query pipelines directly from the terminal.
   - `apps/sdk`: Contains SDK wrappers for JS (`js-sdk`) and Python (`py-sdk`) to interact with the deployed AI servers.
   - `apps/docs`: Documentation site built with Mintlify.

## Key Technologies

- **Web Framework**: Next.js 15+ (App Router)
- **UI Components**: shadcn/ui, Tailwind CSS v4, Framer Motion
- **AI SDK**: Vercel AI SDK (`@ai-sdk/openai`, `@ai-sdk/anthropic`, etc.)
- **Vector DB**: LanceDB (default local choice)
- **Package Manager & Build**: `pnpm` and `turbo`

## Core Concepts

- **Ingestion**: Documents are uploaded via the Web UI or CLI. They are stored logically via `documents-store`.
- **Indexing**: The `indexer` chunks text, embeds it using `@ai-sdk` providers, and stores it in the configured vector store.
- **Deployment**: The user's configuration is used to dynamically spin up a custom AI server with an OpenAPI-compatible endpoint.
- **Media Indexing**: Images, video, and audio are uploaded via the Media panel. Images are captioned (vision LLM) and indexed as text. Video/audio require the "Video & Audio" marketplace tool for transcription and frame extraction.
- **Marketplace**: Optional features are installable tools. The `@larkup/marketplace` package manages the dynamic registry (reads `tool.manifest.json` files, queries the Hub API), installation (real `npm install` into isolated `.larkup/tools/node_modules/`), and runtime loading. Tools are published as standalone npm packages (`@larkup/tool-*`). The Hub API (`apps/hub`) serves the remote catalog, tracks installs, and provides curl install scripts.
