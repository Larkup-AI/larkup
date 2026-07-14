# Larkup Desktop

Native desktop application for Larkup Studio, built with [Tauri 2](https://tauri.app).

Wraps the full Next.js web app inside a native window. The Node.js server runs as a bundled sidecar binary, so end users don't need to install Node, pnpm, or anything else. They just open the app.

## Architecture

```
Tauri (native window + webview)
  └─ Sidecar: larkup-server binary (Node.js + Next.js standalone)
       ├─ Port 4567  → Larkup Studio UI
       ├─ Port 8080  → Generated RAG Server (started from the UI)
       └─ Port 3002  → Local Firecrawl scraper (Docker, optional)
```

## Prerequisites

| Tool    | Version |
| ------- | ------- |
| Rust    | 1.70+   |
| Node.js | 20+     |
| pnpm    | 10+     |

On macOS you also need Xcode Command Line Tools:

```bash
xcode-select --install
```

## Development

```bash
# Run the desktop app in dev mode (handles sidecar build automatically)
bash dev.sh
```

## Building Installers

### macOS (.dmg)

```bash
pnpm build:sidecar
pnpm build
# Output: src-tauri/target/release/bundle/dmg/Larkup_0.1.0_aarch64.dmg
```

### Windows (.exe via NSIS)

```bash
pnpm build:sidecar
pnpm build
# Output: src-tauri/target/release/bundle/nsis/Larkup_0.1.0_x64-setup.exe
```

### Cross compilation

To build for a different platform, set the Rust target:

```bash
rustup target add x86_64-pc-windows-msvc
pnpm build -- --target x86_64-pc-windows-msvc
```

You will also need to rebuild the sidecar for that target.

## License Key

Currently, the community edition of Larkup Desktop does not require a license key.
Future enterprise editions will require a key for advanced features like RBAC and SSO.
