# @larkup/vector-stores

## 0.1.27

### Patch Changes

- 847b502: Keep global installs and updates quiet and compatible by aligning Apache Arrow with LanceDB's
  supported peer range, shipping the marketplace TypeScript runtime loader, and using the renamed
  Daytona SDK package. Public tarballs also scrub local project state from all traced workspaces.

## 0.1.26

### Patch Changes

- Rename the channel adapter package to `@larkup/connections` and remove its type-only dependency cycle with `@larkup/core`.

## 0.1.25

### Patch Changes

- c12b4ec: Pin Apache Arrow to the range supported by LanceDB to prevent npm peer-dependency warnings during installation. Include public images in the standalone server bundle so logos and icons load after installing Larkup from npm.

## 0.1.24

### Patch Changes

- 8b470e7: fix: add missing apache-arrow dependency and silence docker error spam

  - Added `apache-arrow` as an explicit dependency to satisfy the `@lancedb/lancedb` peer requirement. This fixes the "Cannot find module 'apache-arrow'" error during indexing on fresh installs.
  - Removed noisy Docker error logs from the scraper local-runtime. Docker is optional and most curl-install users won't have it, so the console.error spam is unnecessary.

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
