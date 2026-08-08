# larkup

## 0.1.73

### Patch Changes

- f44fa11: Preserve request validation errors while blocking data ingestion until an embedding provider is configured.

## 0.1.72

### Patch Changes

- aa75e4b: Route native AI providers independently from Vercel AI Gateway, refresh the direct Gemini tool-call catalog, correct Gemini embedding metadata, and prevent ingestion before embeddings are configured.
- Updated dependencies [aa75e4b]
  - @larkup/core@0.4.2
  - @larkup/marketplace@0.1.25
  - @larkup/scraper@0.1.38
  - @larkup/tool-doc-editor@0.2.15
  - @larkup/tool-video-audio@0.5.0

## 0.1.71

### Patch Changes

- 81c7c57: Improve media setup guidance and YouTube URL previews, and preserve ordered-list numbering in chat replies.

## 0.1.70

### Patch Changes

- 66d8dba: Use the Warm Ivory theme by default for new web workspaces while preserving saved theme preferences.

## 0.1.69

### Patch Changes

- 4fb5aba: Fix standalone native runtime bindings for E2E and production.

## 0.1.68

### Patch Changes

- Make the standalone postbuild compatible with Docker release images.

## 0.1.67

### Patch Changes

- c12b4ec: Pin Apache Arrow to the range supported by LanceDB to prevent npm peer-dependency warnings during installation. Include public images in the standalone server bundle so logos and icons load after installing Larkup from npm.
- Updated dependencies [c12b4ec]
  - @larkup/vector-stores@0.1.25
  - @larkup/core@0.4.1
  - @larkup/marketplace@0.1.24
  - @larkup/scraper@0.1.37
  - @larkup/tool-doc-editor@0.2.14
  - @larkup/tool-video-audio@0.5.0

## 0.1.66

### Patch Changes

- be8763c: Fix installer removal leaving files and optimize CI pipeline

## 0.1.65

### Patch Changes

- 5d04242: Add a confirmed `larkup remove` command that removes the global installation and its local data.

## 0.1.64

### Patch Changes

- Keep local workspace data, environment files, and duplicated dependencies out
  of the standalone npm artifact.

## 0.1.63

### Patch Changes

- Updated dependencies [07e35de]
  - @larkup/core@0.4.0
  - @larkup/tool-video-audio@0.5.0
  - @larkup/marketplace@0.1.23
  - @larkup/scraper@0.1.36
  - @larkup/tool-doc-editor@0.2.13

## 0.1.62

### Patch Changes

- 7805168: Align the npm runtime dependency on Next.js with the standalone production build.

## 0.1.61

### Patch Changes

- 81a619b: Ship only the standalone production runtime in the npm package and externalize the SSH runtime dependency during the Next.js build.

## 0.1.60

### Patch Changes

- 9962fb6: Add searchable, type-filtered integration resource selection in the data panel.
- Updated dependencies [561c800]
  - @larkup/integrations@0.2.0

## 0.1.59

### Patch Changes

- e8366d0: Fix PDF uploads in standalone deployments.

## 0.1.58

### Patch Changes

- 9a565c8: Make chat retrieval resilient to partial index runs, reuse successful evidence for clear follow-up questions, and keep retrieval-only responses free of internal implementation details. Media previews are available when supported by retrieved evidence.

## 0.1.57

### Patch Changes

- 57a3be9: Offer a one-click Video & Audio tool update when an older installation asks the user to install yt-dlp manually.
- Updated dependencies [57a3be9]
  - @larkup/marketplace@0.1.22
  - @larkup/tool-video-audio@0.3.6
  - @larkup/tool-doc-editor@0.2.12

## 0.1.56

### Patch Changes

- 4398407: Automatically prepare the official yt-dlp executable for YouTube imports, removing the host installation requirement.
- Updated dependencies [4398407]
  - @larkup/marketplace@0.1.21
  - @larkup/tool-video-audio@0.3.5
  - @larkup/tool-doc-editor@0.2.12

## 0.1.55

### Patch Changes

- 7601d83: Update Video & Audio from the Media page when an installed tool is stale, and prefer the newest marketplace catalog version so packaged ffmpeg helpers load correctly after installation.
- Updated dependencies [7601d83]
  - @larkup/marketplace@0.1.20
  - @larkup/tool-video-audio@0.3.4
  - @larkup/tool-doc-editor@0.2.12

## 0.1.54

### Patch Changes

- d7d293c: Make Chat retrieval-only, reliably parse PDFs in Next deployments, simplify website entry, and prevent stale Video & Audio metadata from requiring a host ffmpeg installation.
- Updated dependencies [d7d293c]
  - @larkup/core@0.3.4
  - @larkup/marketplace@0.1.19
  - @larkup/scraper@0.1.35
  - @larkup/tool-doc-editor@0.2.12
  - @larkup/tool-video-audio@0.3.3

## 0.1.53

### Patch Changes

- bde8141: Allow bundled video and audio files to stage before optional processing is configured.

## 0.1.52

### Patch Changes

- 23cb4ee: Keep video and audio staging responsive when a browser cannot read media metadata, and stabilize media E2E selectors.

## 0.1.51

### Patch Changes

- 426c3e3: Make the chat history control accessible and keep production E2E checks aligned with the configured server port.

## 0.1.50

### Patch Changes

- ebd798e: Search indexed media before web search for named match-result and score questions, so chat answers can use video evidence without requiring users to repeat that the recording was uploaded.
- 2d0d490: Improve AI Gateway rate-limit recovery and make video processing use bundled ffmpeg binaries without a system dependency.
- e40bbe8: Harden installer validation across supported operating systems and align bundled runtime requirements with Node.js 22.
- e40bbe8: Make the built-in crawler available without Docker setup, route native requests through saved proxy settings, and report empty failed crawls accurately.
- 2d0d490: Simplify the knowledge-ingestion experience with background website crawling, unified media entry, and separate Add and Knowledge Base navigation.
- Updated dependencies [0f990fc]
- Updated dependencies [2d0d490]
- Updated dependencies [e40bbe8]
  - @larkup/tool-video-audio@0.3.3
  - @larkup/marketplace@0.1.18
  - @larkup/scraper@0.1.34
  - @larkup/core@0.3.3
  - @larkup/tool-doc-editor@0.2.11

## 0.1.49

### Patch Changes

- 3537604: Keep optional video and audio binaries outside the Next.js server bundle.

## 0.1.48

### Patch Changes

- aae57aa: Recover gracefully from embedding quota limits, improve Knowledge Base and visual-answer UX, and bundle video processing binaries so media tooling installs without a separate ffmpeg setup.
- Updated dependencies [aae57aa]
  - @larkup/core@0.3.2
  - @larkup/marketplace@0.1.17
  - @larkup/tool-video-audio@0.3.2
  - @larkup/scraper@0.1.33
  - @larkup/tool-doc-editor@0.2.10

## 0.1.47

### Patch Changes

- Updated dependencies [5da7a99]
  - @larkup/tool-video-audio@0.3.1
  - @larkup/marketplace@0.1.16
  - @larkup/tool-doc-editor@0.2.9

## 0.1.46

### Patch Changes

- Updated dependencies [f23cba6]
  - @larkup/marketplace@0.1.15
  - @larkup/tool-doc-editor@0.2.9
  - @larkup/tool-video-audio@0.3.0

## 0.1.45

### Patch Changes

- 8b470e7: fix: add missing apache-arrow dependency and silence docker error spam

  - Added `apache-arrow` as an explicit dependency to satisfy the `@lancedb/lancedb` peer requirement. This fixes the "Cannot find module 'apache-arrow'" error during indexing on fresh installs.
  - Removed noisy Docker error logs from the scraper local-runtime. Docker is optional and most curl-install users won't have it, so the console.error spam is unnecessary.

- Updated dependencies [8b470e7]
  - @larkup/vector-stores@0.1.24
  - @larkup/scraper@0.1.32
  - @larkup/core@0.3.1
  - @larkup/marketplace@0.1.14
  - @larkup/tool-doc-editor@0.2.9
  - @larkup/tool-video-audio@0.3.0

## 0.1.44

### Patch Changes

- Updated dependencies [02fbbba]
  - @larkup/core@0.3.0
  - @larkup/tool-video-audio@0.3.0
  - @larkup/marketplace@0.1.13
  - @larkup/scraper@0.1.31
  - @larkup/tool-doc-editor@0.2.8

## 0.1.43

### Patch Changes

- 80f79b0: Prevent image-description retries from being cancelled by outer request aborts.

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
