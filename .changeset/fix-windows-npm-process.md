---
"larkup": patch
---

Launch npm through `cmd.exe` on Windows so `larkup update` and `larkup remove` work reliably with Node.js 24 instead of failing with `spawn EINVAL`.
