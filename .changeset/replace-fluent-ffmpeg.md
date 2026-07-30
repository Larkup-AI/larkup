---
"@larkup/tool-video-audio": patch
"@larkup/marketplace": patch
---

Replace deprecated fluent-ffmpeg with direct child_process.spawn calls. Eliminates npm deprecation warnings for fluent-ffmpeg and node-domexception. Increases auto-install timeout to 5min for large dependencies like ffmpeg.
