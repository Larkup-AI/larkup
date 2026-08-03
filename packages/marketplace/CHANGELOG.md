# @larkup/marketplace

## 0.1.22

### Patch Changes

- 57a3be9: Offer a one-click Video & Audio tool update when an older installation asks the user to install yt-dlp manually.

## 0.1.21

### Patch Changes

- 4398407: Automatically prepare the official yt-dlp executable for YouTube imports, removing the host installation requirement.

## 0.1.20

### Patch Changes

- 7601d83: Update Video & Audio from the Media page when an installed tool is stale, and prefer the newest marketplace catalog version so packaged ffmpeg helpers load correctly after installation.

## 0.1.19

### Patch Changes

- d7d293c: Make Chat retrieval-only, reliably parse PDFs in Next deployments, simplify website entry, and prevent stale Video & Audio metadata from requiring a host ffmpeg installation.
- Updated dependencies [d7d293c]
  - @larkup/core@0.3.4

## 0.1.18

### Patch Changes

- 2d0d490: Improve AI Gateway rate-limit recovery and make video processing use bundled ffmpeg binaries without a system dependency.
- Updated dependencies [e40bbe8]
  - @larkup/core@0.3.3

## 0.1.17

### Patch Changes

- aae57aa: Recover gracefully from embedding quota limits, improve Knowledge Base and visual-answer UX, and bundle video processing binaries so media tooling installs without a separate ffmpeg setup.
- Updated dependencies [aae57aa]
  - @larkup/core@0.3.2

## 0.1.16

### Patch Changes

- 5da7a99: Replace deprecated fluent-ffmpeg with direct child_process.spawn calls. Eliminates npm deprecation warnings for fluent-ffmpeg and node-domexception. Increases auto-install timeout to 5min for large dependencies like ffmpeg.

## 0.1.15

### Patch Changes

- f23cba6: Auto-install missing system dependencies (e.g. ffmpeg) during tool installation using the platform package manager (brew on macOS, apt/dnf/pacman/apk on Linux). Falls back to actionable error messages with the exact install command when auto-install is not possible.

## 0.1.14

### Patch Changes

- @larkup/core@0.3.1

## 0.1.13

### Patch Changes

- Updated dependencies [02fbbba]
  - @larkup/core@0.3.0

## 0.1.12

### Patch Changes

- Updated dependencies
  - @larkup/core@0.2.6

## 0.1.11

### Patch Changes

- Updated dependencies [2a0a7e2]
  - @larkup/core@0.2.5

## 0.1.10

### Patch Changes

- c1b12cb: Restore reliable no-Docker local crawler search with a resilient public-search fallback, make current-event chat questions use enabled web search, speed up first-party tool installation, and improve media URL progress handling. Simplify settings and prompt UX, and make failed-crawl URL copying reliable.

## 0.1.9

### Patch Changes

- 5ba20af: Make the local crawler work without Docker, make Marketplace installs opt-in and removable, and bound RAG retrieval tool loops and context growth.

## 0.1.8

### Patch Changes

- 592c637: Fix standalone startup and Docker runtime compatibility, make bundled marketplace tools ready immediately, and improve ingestion, chat retrieval, media preview, and analytics feedback.

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
