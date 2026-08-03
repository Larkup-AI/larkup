# @larkup/tool-video-audio

## 0.3.5

### Patch Changes

- 4398407: Automatically prepare the official yt-dlp executable for YouTube imports, removing the host installation requirement.

## 0.3.4

### Patch Changes

- 7601d83: Update Video & Audio from the Media page when an installed tool is stale, and prefer the newest marketplace catalog version so packaged ffmpeg helpers load correctly after installation.

## 0.3.3

### Patch Changes

- 0f990fc: Prevent optional Local Whisper support from breaking Video & Audio indexing when it is not installed, and make the tool's ESM video processor load correctly at runtime.
- 2d0d490: Improve AI Gateway rate-limit recovery and make video processing use bundled ffmpeg binaries without a system dependency.

## 0.3.2

### Patch Changes

- aae57aa: Recover gracefully from embedding quota limits, improve Knowledge Base and visual-answer UX, and bundle video processing binaries so media tooling installs without a separate ffmpeg setup.

## 0.3.1

### Patch Changes

- 5da7a99: Replace deprecated fluent-ffmpeg with direct child_process.spawn calls. Eliminates npm deprecation warnings for fluent-ffmpeg and node-domexception. Increases auto-install timeout to 5min for large dependencies like ffmpeg.

## 0.3.0

### Minor Changes

- 02fbbba: Added smart video indexing capabilities:
  - `@larkup/core`: Added `indexingInstructions` and `indexingQuality` to `MediaAsset`.
  - `@larkup/tool-video-audio`: Implemented running state carry-forward and cumulative state extraction for multimodal segments.

## 0.2.4

### Patch Changes

- 0ff7dec: Stabilize native crawl state, prioritise local knowledge retrieval, and improve media-import progress and source-download recovery.

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
