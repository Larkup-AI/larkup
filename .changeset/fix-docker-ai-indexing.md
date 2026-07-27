---
"larkup": patch
"@larkup/vector-stores": patch
"@larkup/tool-video-audio": patch
"@larkup/marketplace": patch
---

fix: Docker compatibility, AI agent tool priority, and indexing reliability

- Fix yt-dlp "No supported JavaScript runtime" error in Docker by passing --js-runtimes nodejs:node
- Fix LanceDB "Found field not in schema: metadata" by always serializing metadata column
- Speed up Marketplace tool installs in Docker with --prefer-offline
- Enforce RAG-first tool priority: searchKnowledgeBase → webSearch → other tools
- Instruct AI to use presentMedia for image previews instead of raw markdown (fixes [Image unavailable])
- Strengthen webSearch tool description to enforce secondary priority
