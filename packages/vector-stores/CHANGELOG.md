# @larkup/vector-stores

## 0.1.23

### Patch Changes

- 197c629: fix: Docker compatibility, AI agent tool priority, and indexing reliability

  - Fix yt-dlp "No supported JavaScript runtime" error in Docker by passing --js-runtimes nodejs:node
  - Fix LanceDB "Found field not in schema: metadata" by always serializing metadata column
  - Speed up Marketplace tool installs in Docker with --prefer-offline
  - Enforce RAG-first tool priority: searchKnowledgeBase → webSearch → other tools
  - Instruct AI to use presentMedia for image previews instead of raw markdown (fixes [Image unavailable])
  - Strengthen webSearch tool description to enforce secondary priority

## 0.1.22

### Patch Changes

- 08e7029: Fix LanceDB native-module loading in packaged Larkup installations, align marketplace catalog versions with published tools, and make clearing a knowledge base discoverable.

## 0.1.21

### Patch Changes

- 5caaf2f: feat: support persistent S3-compatible LanceDB storage for serverless deployments
