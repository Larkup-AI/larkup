---
"larkup": patch
"@larkup/cli": patch
"@larkup/vector-stores": patch
"@larkup/scraper": patch
---

fix: add missing apache-arrow dependency and silence docker error spam

- Added `apache-arrow` as an explicit dependency to satisfy the `@lancedb/lancedb` peer requirement. This fixes the "Cannot find module 'apache-arrow'" error during indexing on fresh installs.
- Removed noisy Docker error logs from the scraper local-runtime. Docker is optional and most curl-install users won't have it, so the console.error spam is unnecessary.
