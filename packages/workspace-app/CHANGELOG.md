# @larkup/workspace-app

## 0.2.6

### Patch Changes

- Keep visibility ledgers from answering unrelated visual questions, route missing visual attributes to bounded re-watch, preserve complete long-source inventories, and fall back from blocked provider embeds to local playback or a clean source link.

## 0.2.5

### Patch Changes

- 3804f1f: Preserve compact PDF page selections across chat turns so image follow-ups can render the inspected source directly.

## 0.2.4

### Patch Changes

- 0938bda: Render image follow-ups directly from their grounded source and show indeterminate progress for work without a measurable completion percentage.

## 0.2.3

### Patch Changes

- Updated dependencies [d961166]
  - @larkup/core@0.8.2
  - @larkup/tool-doc-editor@0.3.2

## 0.2.2

### Patch Changes

- f46e865: Keep corpus loading and deletion states consistent, show immediate file preparation progress, and stage image-only PDFs for vision indexing.

## 0.2.1

### Patch Changes

- 77b85cf: Render the Chat workspace shell while its initial configuration is loading.
- Updated dependencies [67ff256]
  - @larkup/core@0.8.1
  - @larkup/tool-doc-editor@0.3.1

## 0.2.0

### Minor Changes

- d515b4c: Move canonical chat, data, integrations, media and model settings components into a reusable application package. Local and Cloud import the same implementations.

### Patch Changes

- ee0b5f6: Fix empty chat workspace logo asset paths and adjust corpus panel inspector preview height.
- d515b4c: Recognize image-only PDFs and automatically route their rendered pages through document image indexing instead of treating generated page counters as extracted text.
- Updated dependencies [d515b4c]
- Updated dependencies [d515b4c]
- Updated dependencies [d515b4c]
- Updated dependencies [d515b4c]
- Updated dependencies [d515b4c]
- Updated dependencies [d515b4c]
- Updated dependencies [037eff5]
  - @larkup/core@0.8.0
  - @larkup/tool-doc-editor@0.3.0
  - @larkup/workspace-ui@0.2.0
