# @larkup/core

## 0.3.4

### Patch Changes

- d7d293c: Make Chat retrieval-only, reliably parse PDFs in Next deployments, simplify website entry, and prevent stale Video & Audio metadata from requiring a host ffmpeg installation.

## 0.3.3

### Patch Changes

- e40bbe8: Make the built-in crawler available without Docker setup, route native requests through saved proxy settings, and report empty failed crawls accurately.

## 0.3.2

### Patch Changes

- aae57aa: Recover gracefully from embedding quota limits, improve Knowledge Base and visual-answer UX, and bundle video processing binaries so media tooling installs without a separate ffmpeg setup.

## 0.3.1

### Patch Changes

- Updated dependencies [8b470e7]
  - @larkup/vector-stores@0.1.24

## 0.3.0

### Minor Changes

- 02fbbba: Added smart video indexing capabilities:
  - `@larkup/core`: Added `indexingInstructions` and `indexingQuality` to `MediaAsset`.
  - `@larkup/tool-video-audio`: Implemented running state carry-forward and cumulative state extraction for multimodal segments.

## 0.2.6

### Patch Changes

- Improve smart RAG and web fallback, PDF visual retrieval, and resilient video indexing.

## 0.2.5

### Patch Changes

- 2a0a7e2: Improve automatic indexing and media processing controls, make settings navigation resilient to slow tool loading, and keep knowledge-base retrieval ahead of web search.

## 0.2.4

### Patch Changes

- Updated dependencies [197c629]
  - @larkup/vector-stores@0.1.23

## 0.2.3

### Patch Changes

- Fix Docker data persistence, Marketplace installs, crawler readiness, and workspace-aware RAG retrieval.

## 0.2.2

### Patch Changes

- 6241db2: Prevent chat responses from rendering unverified image URLs and clarify the single-port Docker web app launch.

## 0.2.1

### Patch Changes

- Updated dependencies [08e7029]
  - @larkup/vector-stores@0.1.22

## 0.2.0

### Minor Changes

- efc6810: Add folder and media indexing, corpus management, Marketplace Hub operations, deployment and update commands, browser opening, CLI validation, streaming chat, complete RAG endpoint coverage, bulk SDK indexing progress, and typed Hub discovery.
- 843ef5c: Add caption-first YouTube indexing, bounded long-form audio transcription, scene-aware video indexing, outcome-aware ending retrieval, media processing analytics, and timestamped chat citations.

### Patch Changes

- 5caaf2f: feat: support persistent S3-compatible LanceDB storage for serverless deployments
- 8042a54: Index video and audio as multilingual timestamped evidence with adaptive sampling, complete-media notes, outcome-aware retrieval, and durable per-stage live progress.
- b7bc6fe: Pin generated server AI SDK provider packages to compatible major versions so embedding and query endpoints do not mix incompatible model specifications.
- Updated dependencies [5caaf2f]
  - @larkup/vector-stores@0.1.21
