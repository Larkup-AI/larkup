# larkup

## 0.1.42

### Patch Changes

- Improve smart RAG and web fallback, PDF visual retrieval, and resilient video indexing.
- Updated dependencies
  - @larkup/core@0.2.6
  - @larkup/marketplace@0.1.12
  - @larkup/scraper@0.1.30
  - @larkup/tool-doc-editor@0.2.7
  - @larkup/tool-video-audio@0.2.4

## 0.1.41

### Patch Changes

- 0ff7dec: Stabilize native crawl state, prioritise local knowledge retrieval, and improve media-import progress and source-download recovery.
- Updated dependencies [0ff7dec]
  - @larkup/scraper@0.1.29
  - @larkup/tool-video-audio@0.2.4

## 0.1.40

### Patch Changes

- 2a0a7e2: Improve automatic indexing and media processing controls, make settings navigation resilient to slow tool loading, and keep knowledge-base retrieval ahead of web search.
- Updated dependencies [2a0a7e2]
  - @larkup/core@0.2.5
  - @larkup/marketplace@0.1.11
  - @larkup/scraper@0.1.28
  - @larkup/tool-doc-editor@0.2.6
  - @larkup/tool-video-audio@0.2.3

## 0.1.39

### Patch Changes

- Fix TS2448 ReferenceError in data-workspace.tsx caused by docsQuery declaration order

## 0.1.38

### Patch Changes

- Fix 10 production issues: SSE controller-closed error, cleaner system prompt, smarter KB search, one-shot web search, corpus refresh after scrape, minimal KB loading UI, settings sidebar navigation, force-delete processing media, playlist confirmation, image preview in chat, marketplace install progress toast.

## 0.1.37

### Patch Changes

- c1b12cb: Restore reliable no-Docker local crawler search with a resilient public-search fallback, make current-event chat questions use enabled web search, speed up first-party tool installation, and improve media URL progress handling. Simplify settings and prompt UX, and make failed-crawl URL copying reliable.
- Updated dependencies [c1b12cb]
  - @larkup/scraper@0.1.27
  - @larkup/marketplace@0.1.10
  - @larkup/tool-video-audio@0.2.3
  - @larkup/tool-doc-editor@0.2.5

## 0.1.36

### Patch Changes

- 9dd3603: Build workspace tool dependencies before the web app in Docker images.

## 0.1.35

### Patch Changes

- 5ba20af: Make the local crawler work without Docker, make Marketplace installs opt-in and removable, and bound RAG retrieval tool loops and context growth.
- Updated dependencies [5ba20af]
  - @larkup/scraper@0.1.26
  - @larkup/marketplace@0.1.9
  - @larkup/tool-doc-editor@0.2.5
  - @larkup/tool-video-audio@0.2.2

## 0.1.34

### Patch Changes

- c9724ff: Ship Next.js browser assets inside the standalone runtime so curl and npm installations load the UI instead of returning static-asset 404s.

## 0.1.33

### Patch Changes

- f1bb8e2: Wait for the chat page and workspace API to be ready before `larkup dev` opens the browser, avoiding the standalone startup loading screen.

## 0.1.32

### Patch Changes

- 592c637: Fix standalone startup and Docker runtime compatibility, make bundled marketplace tools ready immediately, and improve ingestion, chat retrieval, media preview, and analytics feedback.
- Updated dependencies [592c637]
  - @larkup/marketplace@0.1.8
  - @larkup/tool-doc-editor@0.2.5
  - @larkup/tool-video-audio@0.2.2

## 0.1.31

### Patch Changes

- 197c629: fix: Docker compatibility, AI agent tool priority, and indexing reliability

  - Fix yt-dlp "No supported JavaScript runtime" error in Docker by passing --js-runtimes nodejs:node
  - Fix LanceDB "Found field not in schema: metadata" by always serializing metadata column
  - Speed up Marketplace tool installs in Docker with --prefer-offline
  - Enforce RAG-first tool priority: searchKnowledgeBase → webSearch → other tools
  - Instruct AI to use presentMedia for image previews instead of raw markdown (fixes [Image unavailable])
  - Strengthen webSearch tool description to enforce secondary priority

- Updated dependencies [197c629]
  - @larkup/vector-stores@0.1.23
  - @larkup/tool-video-audio@0.2.2
  - @larkup/marketplace@0.1.7
  - @larkup/core@0.2.4
  - @larkup/tool-doc-editor@0.2.5
  - @larkup/scraper@0.1.25

## 0.1.30

### Patch Changes

- Fix Docker data persistence, Marketplace installs, crawler readiness, and workspace-aware RAG retrieval.
- Updated dependencies
  - @larkup/core@0.2.3
  - @larkup/marketplace@0.1.6
  - @larkup/scraper@0.1.24
  - @larkup/tool-doc-editor@0.2.4
  - @larkup/tool-video-audio@0.2.1

## 0.1.29

### Patch Changes

- 19767f8: Fix isolated Marketplace tool loading in Docker, improve Video & Audio setup guidance, and reliably index PDF images.
- Updated dependencies [19767f8]
  - @larkup/marketplace@0.1.5
  - @larkup/tool-doc-editor@0.2.3
  - @larkup/tool-video-audio@0.2.1

## 0.1.28

### Patch Changes

- c769d08: Retry marketplace installs against the latest published package when a stale catalog version is unavailable, and improve server and analytics UI behavior.
- Updated dependencies [c769d08]
  - @larkup/marketplace@0.1.4
  - @larkup/tool-doc-editor@0.2.3
  - @larkup/tool-video-audio@0.2.1

## 0.1.27

### Patch Changes

- 6241db2: Prevent chat responses from rendering unverified image URLs and clarify the single-port Docker web app launch.
- Updated dependencies [6241db2]
  - @larkup/core@0.2.2
  - @larkup/marketplace@0.1.3
  - @larkup/scraper@0.1.23
  - @larkup/tool-doc-editor@0.2.3
  - @larkup/tool-video-audio@0.2.1

## 0.1.26

### Patch Changes

- 08e7029: Fix LanceDB native-module loading in packaged Larkup installations, align marketplace catalog versions with published tools, and make clearing a knowledge base discoverable.
- Updated dependencies [08e7029]
  - @larkup/vector-stores@0.1.22
  - @larkup/marketplace@0.1.2
  - @larkup/tool-doc-editor@0.2.2
  - @larkup/tool-video-audio@0.2.1
  - @larkup/core@0.2.1
  - @larkup/scraper@0.1.22

## 0.1.25

### Patch Changes

- fix: lazy-import dockerode to prevent Turbopack hash mangling at runtime
- Updated dependencies
  - @larkup/sandbox@0.1.2
  - @larkup/tool-doc-editor@0.2.1

## 0.1.24

### Patch Changes

- f1ed7b1: fix: update install script UX and fix dockerode bundling bug

## 0.1.23

### Patch Changes

- Use `my-larkup` as the initial project name in the web onboarding flow.

## 0.1.22

### Patch Changes

- Make `larkup dev` start and open the main Larkup web application on port 4567.

## 0.1.21

### Patch Changes

- 4e54939: feat: add doc-editor tool and canvas preview
- 8f51b5c: Route image and video-frame analysis through the configured chat provider and model, keeping marketplace audio-provider settings isolated to transcription.
- 8201d67: Replace the Web update notification with a minimal theme-aware banner that copies the correct CLI or Docker update command.
- 5caaf2f: feat: support persistent S3-compatible LanceDB storage for serverless deployments
- 8042a54: Index video and audio as multilingual timestamped evidence with adaptive sampling, complete-media notes, outcome-aware retrieval, and durable per-stage live progress.
- Updated dependencies [4e54939]
- Updated dependencies [efc6810]
- Updated dependencies [5caaf2f]
- Updated dependencies [8042a54]
- Updated dependencies [843ef5c]
- Updated dependencies [b7bc6fe]
  - @larkup/tool-doc-editor@0.2.0
  - @larkup/marketplace@0.1.1
  - @larkup/sandbox@0.1.1
  - @larkup/core@0.2.0
  - @larkup/vector-stores@0.1.21
  - @larkup/tool-video-audio@0.2.0
  - @larkup/scraper@0.1.21
