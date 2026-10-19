# @larkup/workspace-server

## 0.2.2

### Patch Changes

- e997fd8: Prevent unrelated single-media fallbacks and end no-evidence chat turns without allowing a model to answer from general knowledge.

## 0.2.1

### Patch Changes

- Updated dependencies [67ff256]
  - @larkup/core@0.8.1
  - @larkup/marketplace@0.3.10
  - @larkup/tool-doc-editor@0.3.1
  - @larkup/scraper@0.2.1

## 0.2.0

### Minor Changes

- d515b4c: Share the chat API, tool selection and data algorithms across hosts using request-scoped persistence adapters.

### Patch Changes

- d515b4c: Recognize image-only PDFs and automatically route their rendered pages through document image indexing instead of treating generated page counters as extracted text.
- 3103955: Scope sandbox availability caching to the active workspace host so one tenant's missing credentials cannot hide analysis tools for another tenant with the same public configuration.
- d515b4c: Render exact whole-recording speech as a modality-filtered, cursor-paged table so long transcripts remain complete without entering the answer model context.
- d515b4c: Route unambiguous chart requests directly through structured tabular data and render a concise chart insight without RAG or raw-row prose.
- d515b4c: Render video knowledge summaries without English structural labels so source-language notes remain source-language in every host.
- 0837ebc: Expand isRetryableManagedVideoWorkerFailure to handle worker overload and capacity retry errors.
- Updated dependencies [d515b4c]
- Updated dependencies [d515b4c]
- Updated dependencies [d515b4c]
- Updated dependencies [d515b4c]
- Updated dependencies [d515b4c]
  - @larkup/core@0.8.0
  - @larkup/marketplace@0.3.9
  - @larkup/tool-doc-editor@0.3.0
  - @larkup/scraper@0.2.0
