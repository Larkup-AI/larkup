# @larkup/tool-video-audio

## 0.2.3

### Patch Changes

- c1b12cb: Restore reliable no-Docker local crawler search with a resilient public-search fallback, make current-event chat questions use enabled web search, speed up first-party tool installation, and improve media URL progress handling. Simplify settings and prompt UX, and make failed-crawl URL copying reliable.

## 0.2.2

### Patch Changes

- 197c629: fix: Docker compatibility, AI agent tool priority, and indexing reliability

  - Fix yt-dlp "No supported JavaScript runtime" error in Docker by passing --js-runtimes nodejs:node
  - Fix LanceDB "Found field not in schema: metadata" by always serializing metadata column
  - Speed up Marketplace tool installs in Docker with --prefer-offline
  - Enforce RAG-first tool priority: searchKnowledgeBase → webSearch → other tools
  - Instruct AI to use presentMedia for image previews instead of raw markdown (fixes [Image unavailable])
  - Strengthen webSearch tool description to enforce secondary priority

## 0.2.1

### Patch Changes

- 08e7029: Fix LanceDB native-module loading in packaged Larkup installations, align marketplace catalog versions with published tools, and make clearing a knowledge base discoverable.

## 0.2.0

### Minor Changes

- 843ef5c: Add caption-first YouTube indexing, bounded long-form audio transcription, scene-aware video indexing, outcome-aware ending retrieval, media processing analytics, and timestamped chat citations.

### Patch Changes

- 8042a54: Index video and audio as multilingual timestamped evidence with adaptive sampling, complete-media notes, outcome-aware retrieval, and durable per-stage live progress.
