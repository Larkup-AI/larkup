---
name: database-guide
description: Instructions for database schema changes, vector stores, and data ingestion concepts. Use when modifying or interacting with LanceDB or any other `@larkup/vector-stores` implementations.
tags: database, vector-stores, lancedb, ingestion
---

# Database & Vector Stores Guide

## Overview

Unlike traditional web applications that rely heavily on relational databases (like PostgreSQL) for all logic, Larkup is built primarily around **Vector Databases** for its core document processing, and uses a local object/file store for configs.

## Vector Stores (`packages/vector-stores`)

Larkup implements an abstraction layer allowing users to choose their vector store. 
- **LanceDB** is the default embedded vector database. It runs locally and persists data efficiently.
- Connectors to Pinecone, Chroma, and others exist or can be added to the `@larkup/vector-stores` package.

### Modifying Vector Stores
1. If you add a new vector store, you must implement the shared interface expected by `@larkup/core`.
2. Ensure you handle both embeddings (float arrays) and associated metadata (strings, dates).

## Data Ingestion & Indexing (`@larkup/core`)

1. **Document Stores**: Raw uploaded files are managed via `documents-store.ts`.
2. **Chunking and Embedding**: The indexing pipeline (`indexer.ts`) takes raw documents, splits them (`chunker.ts`), and generates embeddings using `@ai-sdk` (`embedder.ts`).
3. **Storage**: The embedded chunks are written to the selected vector store.

## Internal Stores

For internal application state (like configuring the custom AI server endpoints, analytics, and active jobs):
- `config-store.ts`
- `jobs-store.ts`
- `analytics-store.ts`
- `media-store.ts` — tracks `MediaAsset` records (images, video, audio). Stores metadata in `media-assets.json`, binary files via `StorageProvider`.

When modifying these stores, ensure changes are strongly typed in `src/types.ts` and handle potential migration states gracefully if adding new fields.

## Media Asset Storage

Media files (images, video, audio) are stored via the `StorageProvider` abstraction from `@larkup/marketplace/storage`:

1. **Local Storage** (default): Files stored under `.larkup/servers/<id>/media/` with sub-directories for type (`images/`, `videos/`, `audio/`).
2. **Cloud Storage** (future): S3, UploadThing, GCS providers can be added by implementing the `StorageProvider` interface.

### Multimodal Indexing Flow

Media assets are processed into `SourceDocument` entries for the standard indexing pipeline:

- **Images** → Vision LLM captioning → text `SourceDocument` (source: `"media"`)
- **Video** → Audio extraction (ffmpeg) + frame extraction → transcript chunks + frame captions → multiple `SourceDocument` entries with timestamp metadata
- **Audio** → Transcription (Whisper API or local) → timestamped chunk `SourceDocument` entries

Each `MediaAsset` tracks which `SourceDocument` IDs were generated from it via the `documentIds` field.

### Marketplace Tool Storage

Installed tool manifests are stored at `.larkup/tools/installed.json`. Tool installation state is managed by `@larkup/marketplace/installer`.
