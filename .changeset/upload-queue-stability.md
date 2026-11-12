---
"@larkup/workspace-app": patch
---

Keep the background upload queue stable across tab switches and surface real
ingest errors.

- The queue, its processing flag, and progress now live in a shared module-level
  store that every mounted panel subscribes to, so switching tabs and coming
  back no longer resets the in-flight batch or makes it appear to stop and
  restart.
- When a document fails to upload, the real server error (including a non-JSON
  HTTP status) is shown instead of the generic "no text could be extracted"
  message, which previously masked failures such as a rejected oversized body.
