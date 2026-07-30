---
"@larkup/marketplace": patch
---

Auto-install missing system dependencies (e.g. ffmpeg) during tool installation using the platform package manager (brew on macOS, apt/dnf/pacman/apk on Linux). Falls back to actionable error messages with the exact install command when auto-install is not possible.
