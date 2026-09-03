---
'@larkup/core': patch
'larkup': patch
---

Keep media indexing visibly active without pretending that unmeasured work is complete. URL downloads publish heartbeats plus measured byte, speed, percentage, and ETA telemetry; worker stage updates retain tenths; and the UI smoothly interpolates sparse updates while fresh worker activity is present, stopping when telemetry is stale or paused and never claiming completion.
