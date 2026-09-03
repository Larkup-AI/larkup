---
'@larkup/tool-video-intelligence': patch
'@larkup/core': patch
'larkup': patch
---

Require direct visual verification before answering a final result from a
paired-value OCR candidate, return long-video timelines from indexed timestamped evidence,
preserve generic subject-relation-value bindings and reject terminal mappings
that conflict with independent chronology across any video genre,
standardize Vercel Gateway credentials on `AI_GATEWAY_API_KEY`, preserve
local-runtime chat progress, and purge local source/result caches when their
media or linked knowledge is deleted.
