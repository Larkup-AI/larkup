---
"@larkup/tool-video-intelligence": patch
---

Keep priority-driven semantic clip selection within the declared model-read budget.
Spool completed clip frames losslessly into job-scoped temporary storage and load
frames lazily for parallel vision and embedding consumers. Expose sampling limits
and frame-storage diagnostics, and add research diagrams and a label-blind video
benchmark harness.
