---
"@larkup/workspace-app": minor
"@larkup/workspace-server": patch
---

Ingest uploaded files through durable background jobs with server-side parsing.

- Files the server can parse (PDF, DOCX, CSV, text, Markdown, JSON, HTML, XML,
  TOML, log) are now uploaded directly to object storage and ingested as a
  single durable knowledge source each — parsed, chunked, embedded and indexed
  in the background worker. The browser no longer parses these files or splits
  large documents into "part N of M", so large files and hundreds of files
  ingest reliably. xlsx/xls/doc keep the existing in-browser path.
- Scanned or image-heavy PDFs (and PDFs with image indexing enabled) are
  rendered page by page and described with the configured vision model during
  ingestion, via a new bytes-based PDF renderer (`renderPdfPagesFromBytes`), so
  their figures and scanned content become searchable.
- The upload confirmation is a plain "Added N files" message, and the queue
  tray reads "Adding N files…", with no background/queue jargon.
