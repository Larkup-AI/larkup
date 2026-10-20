---
'@larkup/core': patch
'@larkup/marketplace': patch
'@larkup/tool-video-intelligence': patch
'@larkup/workspace-server': patch
---

Route settled outcome questions to outcome evidence, prevent unrelated visible-subject recurrences from becoming the final answer, and dispatch remote video materialization through a separate CPU lane instead of the indexing GPU lane.
