---
"@larkup/workspace-app": patch
---

Gate durable server-side file ingestion on a host capability so the shared
upload UI keeps working on hosts without it.

The upload panel now routes files to object storage and the background worker
only when the host advertises the `backgroundFileIngestion` capability (as the
managed Cloud host does). On hosts that do not — such as the local/self-hosted
app, which has no storage-upload or file-ingestion endpoints — PDF, DOCX, CSV
and other files fall back to the existing in-browser parsing path, including
client-side PDF text extraction. This fixes uploads breaking on those hosts.
