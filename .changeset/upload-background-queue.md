---
"@larkup/workspace-app": minor
---

Add a non-blocking background upload queue and fix oversized-document ingestion

- Clicking **Add file** now hands the staged files to a background worker and
  returns immediately instead of blocking the UI. A single sequential worker,
  guarded by a per-project lock so remounts cannot ingest a batch twice, drains
  the queue while the user keeps adding more files. A processing tray shows the
  in-flight files and the queue survives a reload.
- Documents whose content exceeds the API limit (large CSV/spreadsheet exports,
  long text, or image-rich PDFs) are split into ordered, labeled parts instead
  of silently failing the upload. Previously an oversized document produced a
  misleading "no text could be extracted" error and left the corpus empty even
  though the tabular dataset had been saved. The real server error is now
  surfaced, and a structured file saved only as a tabular dataset no longer
  reports a false failure.
