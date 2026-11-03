---
'@larkup/core': patch
'@larkup/tool-video-intelligence': patch
'@larkup/tool-doc-editor': patch
---

Bundle the pinned SheetJS dependency with Core so npm 12 can install Video Intelligence and Document Editor without allowing remote tarball dependencies.
