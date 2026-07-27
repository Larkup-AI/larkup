# @larkup/marketplace

## 0.1.7

### Patch Changes

- 197c629: fix: Docker compatibility, AI agent tool priority, and indexing reliability

  - Fix yt-dlp "No supported JavaScript runtime" error in Docker by passing --js-runtimes nodejs:node
  - Fix LanceDB "Found field not in schema: metadata" by always serializing metadata column
  - Speed up Marketplace tool installs in Docker with --prefer-offline
  - Enforce RAG-first tool priority: searchKnowledgeBase → webSearch → other tools
  - Instruct AI to use presentMedia for image previews instead of raw markdown (fixes [Image unavailable])
  - Strengthen webSearch tool description to enforce secondary priority
  - @larkup/core@0.2.4

## 0.1.6

### Patch Changes

- Fix Docker data persistence, Marketplace installs, crawler readiness, and workspace-aware RAG retrieval.
- Updated dependencies
  - @larkup/core@0.2.3

## 0.1.5

### Patch Changes

- 19767f8: Fix isolated Marketplace tool loading in Docker, improve Video & Audio setup guidance, and reliably index PDF images.

## 0.1.4

### Patch Changes

- c769d08: Retry marketplace installs against the latest published package when a stale catalog version is unavailable, and improve server and analytics UI behavior.

## 0.1.3

### Patch Changes

- Updated dependencies [6241db2]
  - @larkup/core@0.2.2

## 0.1.2

### Patch Changes

- 08e7029: Fix LanceDB native-module loading in packaged Larkup installations, align marketplace catalog versions with published tools, and make clearing a knowledge base discoverable.
  - @larkup/core@0.2.1

## 0.1.1

### Patch Changes

- 4e54939: feat: add doc-editor tool and canvas preview
- 8042a54: Index video and audio as multilingual timestamped evidence with adaptive sampling, complete-media notes, outcome-aware retrieval, and durable per-stage live progress.
- Updated dependencies [efc6810]
- Updated dependencies [5caaf2f]
- Updated dependencies [8042a54]
- Updated dependencies [843ef5c]
- Updated dependencies [b7bc6fe]
  - @larkup/core@0.2.0
