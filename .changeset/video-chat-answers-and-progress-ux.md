---
'@larkup/core': minor
'larkup': minor
---

Fix a budget-policy mismatch that silently skipped the bounded re-inspection needed to answer outcome questions ("who won") on standard installs, by dispatching it as sequential chunks instead of one oversized request. Ground named-person questions ("what was X wearing") to a transcript mention of that name instead of describing the scene generically. Replace the always-on "Supporting clip" video embed and the raw internal progress text with a collapsed-by-default citation card rendered through the same generic chat-result UI contract every marketplace tool uses, an inline chat progress bar for any long-running tool call, and a GPU-cold-start indicator that only shows while a worker is still waking up.
