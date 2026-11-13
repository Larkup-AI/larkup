---
'@larkup/core': patch
'@larkup/sandbox': patch
'@larkup/workspace-server': patch
'@larkup/workspace-app': patch
---

Stabilize source-grounded research and analytical answers.

- Rank relevant schemas independently of upload order, use matching data-dictionary definitions, and honor authoritative source-to-table links.
- Rerank complementary source evidence, preserve bounded supporting passages, and permit one focused research refinement.
- Route full-population calculations, integrity checks, and independent rankings to deterministic analysis; validate requested group coverage and isolate failed output from answer evidence.
- Capture notebook-style Python expressions consistently across local, Docker, and remote runtimes, and render final DataFrames as complete structured results.
- Compact older user context in the background without retaining old assistant claims as facts or removing saved history.
- Distinguish source formats from export requests and reuse verified analysis tables for exports.
- Cache live model availability, reject retired selections, honor the selected reasoning model, and report the provider's actual model ID instead of a silent cross-model fallback.
- Preserve atomic PDF figure annotations and headings, validate passage locators with source quotes, and require the full underlying data for requested analytical charts.
- Serialize missing/nonfinite analytical cells as JSON null so sparse joins remain usable structured answers.
- Preserve derived analysis fields during schema repair, require verifiable group/chart coverage, and finish completed structured results without regenerating their facts as prose.
- Preserve individual user constraints through browser/server compaction and report provider-budget failures explicitly without exposing account details.
