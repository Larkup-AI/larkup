---
'@larkup/tool-video-intelligence': patch
'@larkup/workspace-server': patch
---

Preserve timestamped transcript and OCR evidence beside synthesized trajectories
for sequence investigations, so a later summary does not erase an earlier
source introduction. Report when the bounded source-reading cap is reached.
Allow isolated hosts to supply the existing canonical quick-look with a scoped
model and explicit retry limit, retaining the normal configured defaults.
