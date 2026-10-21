---
'@larkup/workspace-server': patch
'@larkup/workspace-app': patch
---

Require explicit chart intent and reject non-plottable tabular results so ordinary CSV questions no longer produce empty or unnecessary charts.

Preserve explicit large result counts in structured table queries and show returned-versus-matching row coverage in the searchable, paginated chat table instead of streaming long lists as prose.
