---
'@larkup/core': patch
'@larkup/tool-video-intelligence': patch
---

Route source-wide observed-subject questions through the typed visibility aggregate. Focused questions now preserve point timestamps as bounded windows, prioritize the exact local observation, use adjacent scene context, exclude remote subject appearances, and require real visual evidence instead of treating speech or raw object detections as visible identity proof. Bounded live inspections also allow the server a short response grace period so evidence completed at the deadline is returned instead of being reported as unavailable.
