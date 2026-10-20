# @larkup/workspace-server

## 0.2.9

### Patch Changes

- 94ebf3f: Render verified indexed video outcomes directly when the evidence includes a settled winner and a pipe-delimited final state.

## 0.2.8

### Patch Changes

- c2e9a11: Keep final-outcome video questions on the outcome evidence path even when the broad planner classifies them as source synthesis.

## 0.2.7

### Patch Changes

- d961166: Route settled outcome questions to outcome evidence, prevent unrelated visible-subject recurrences from becoming the final answer, and dispatch remote video materialization through a separate CPU lane instead of the indexing GPU lane.
- Updated dependencies [d961166]
  - @larkup/core@0.8.2
  - @larkup/marketplace@0.3.11
  - @larkup/tool-doc-editor@0.3.2
  - @larkup/scraper@0.2.2

## 0.2.6

### Patch Changes

- 63c15ad: Read YouTube's public schema.org duration metadata with a browser-compatible request when serverless extraction is challenged.

## 0.2.5

### Patch Changes

- fd882c2: Recover YouTube durations from signed player stream metadata when reduced serverless player responses omit video details.

## 0.2.4

### Patch Changes

- 338584c: Use YouTube public player metadata before watch-page parsing when the primary extractor is challenged, including serverless environments that receive incomplete watch pages.

## 0.2.3

### Patch Changes

- bbaf8d4: Recover YouTube titles and durations from public watch-page metadata when the primary extractor is temporarily challenged, so remote videos can reserve quota and reach indexing.

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
