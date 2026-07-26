# larkup

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
