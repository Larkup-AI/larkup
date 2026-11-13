---
"@larkup/workspace-app": patch
---

Hide intermediate analysis failures in chat when the planner retries.

When a code-analysis attempt fails and the planner retries within the same
assistant turn, the earlier failed attempt is now hidden as soon as a later
attempt exists — whether it is still running or already completed — so the user
sees only the final result instead of a transient "Analysis failed" card. If
every attempt fails, the last one is still shown.
