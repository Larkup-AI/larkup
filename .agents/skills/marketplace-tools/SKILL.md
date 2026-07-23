---
name: marketplace-tools
description: Guide for adding new marketplace tools/plugins to the Larkup ecosystem. Covers the manifest schema, package structure, registry, loader, and testing.
tags: marketplace, tools, plugins, schema
---

# Adding Marketplace Tools

## Overview

The Larkup Marketplace is a plugin system that allows extending the platform with optional tools. Each tool is a standalone npm package under `packages/tools/` that ships its own `tool.manifest.json` describing its capabilities.

## Architecture

```
packages/marketplace/         ← Core marketplace system
  src/types.ts               ← ToolDescriptor schema, DeploymentTarget, HubConfig
  src/tool-registry.ts       ← Dynamic registry (manifest files → Hub API → fallback)
  src/tool-installer.ts      ← Real npm install into isolated .larkup/tools/
  src/tool-loader.ts         ← Dynamic runtime loader (resolves from isolated dir)
  src/tool-manifest.schema.ts ← Schema validator for manifests
  src/storage-provider.ts    ← Media storage abstraction

packages/tools/              ← Individual tool packages
  video-audio/               ← Video & Audio processing
  doc-editor/                ← Document editing & form filling
  clip-embeddings/           ← CLIP image search (coming soon)

apps/hub/                    ← Hub API (catalog, install tracking, publishing)
  src/index.ts               ← Hono server with /v1/tools routes
  src/store.ts               ← In-memory store (future: Turso)
  src/types.ts               ← Hub-specific types
  api/index.ts               ← Vercel handler
  vercel.json                ← Vercel deployment config

apps/web/
  components/settings/marketplace-section.tsx  ← Marketplace UI
  app/api/marketplace/route.ts                 ← API: list tools
  app/api/marketplace/[toolId]/route.ts        ← API: install/uninstall
```

## Install Architecture

Tools install into an **isolated directory** (`.larkup/tools/node_modules/`):

```
.larkup/tools/
├── package.json             ← Auto-generated for npm install --prefix
├── installed.json           ← Tracks what's installed, config, source
└── node_modules/
    └── @larkup/
        ├── tool-video-audio/
        └── tool-doc-editor/
```

This design:

- Keeps the user's project `package.json` clean (no pollution)
- Makes tools portable — copy `.larkup/tools/` to any machine
- Enables per-agent tool sets (future)
- Works across local, Docker, and sandbox deployments

In the **monorepo** (development mode), tools are resolved via pnpm workspace symlinks — no download needed.

## ToolDescriptor Schema (v1.0)

Every tool must conform to the `ToolDescriptor` interface and ship a `tool.manifest.json`:

```typescript
interface ToolDescriptor {
  id: string; // Unique ID: "my-tool" (lowercase, hyphenated)
  name: string; // Display name: "My Tool"
  description: string; // One-line description
  longDescription?: string; // Detailed description for detail view
  category: ToolCategory; // "media" | "search" | "analytics" | etc.
  version: string; // Semver: "0.1.0"
  pricing: ToolPricing; // "free" | "pro" | "enterprise"
  emoji?: string; // Emoji icon: "🎬"
  iconUrl?: string; // Custom image URL
  icon: string; // Lucide icon name fallback
  packageName: string; // npm package: "@larkup/tool-my-tool"
  installSize: string; // Display size: "~15 MB"
  systemDeps?: string[]; // System requirements: ["ffmpeg"]
  author: string; // Publisher name
  capabilities: string[]; // Feature keys used by core routing
  configSchema?: ToolConfigField[]; // User-configurable options
  tags?: string[]; // Search tags
  downloads: number; // Install count (start at 0)
  repositoryUrl?: string; // GitHub/homepage URL
  license?: string; // "MIT", "Apache-2.0"
  updatedAt?: string; // ISO date of last update
  comingSoon?: boolean; // If true, shown but not installable
}
```

## Step-by-Step: Adding a New Tool

### 1. Create the package

```bash
mkdir -p packages/tools/my-tool/src
```

Create `packages/tools/my-tool/package.json`:

```json
{
  "name": "@larkup/tool-my-tool",
  "version": "0.1.0",
  "type": "module",
  "description": "Larkup marketplace tool: description here.",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./src/index.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist", "src", "tool.manifest.json", "README.md"],
  "scripts": {
    "build": "tsc --outDir dist",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@larkup/core": "workspace:*"
  },
  "peerDependencies": {
    "@larkup/marketplace": ">=0.1.0"
  },
  "peerDependenciesMeta": {
    "@larkup/marketplace": { "optional": true }
  },
  "devDependencies": {
    "@larkup/marketplace": "workspace:*",
    "typescript": "5.7.3"
  },
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/Larkup-AI/larkup-rag",
    "directory": "packages/tools/my-tool"
  }
}
```

### 2. Create the manifest

Create `packages/tools/my-tool/tool.manifest.json`:

```json
{
  "$schema": "https://hub.larkup.de/schemas/tool-manifest.v1.json",
  "id": "my-tool",
  "name": "My Tool",
  "description": "Short description of what this tool does.",
  "category": "utility",
  "version": "0.1.0",
  "pricing": "free",
  "emoji": "🔧",
  "icon": "Wrench",
  "packageName": "@larkup/tool-my-tool",
  "installSize": "~5 MB",
  "author": "Larkup",
  "capabilities": ["my-capability"],
  "tags": ["keyword1", "keyword2"],
  "downloads": 0,
  "repositoryUrl": "https://github.com/...",
  "license": "Apache-2.0",
  "updatedAt": "2026-07-20"
}
```

### 3. Implement the tool

Create `packages/tools/my-tool/src/index.ts`:

```typescript
export const TOOL_META = {
  id: 'my-tool',
  name: 'My Tool',
  version: '0.1.0',
} as const;

// Export your tool's public API
export async function doSomething(): Promise<void> {
  // Implementation
}
```

### 4. Add tsconfig

Create `packages/tools/my-tool/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

### 5. Update the Lucide icon map (if using Lucide fallback)

In `apps/web/components/settings/marketplace-section.tsx`, add your icon to `ICON_MAP`:

```typescript
import { Wrench } from 'lucide-react';
const ICON_MAP: Record<string, LucideIcon> = {
  Film,
  ScanEye,
  Wrench, // ← Add your icon
};
```

### 6. Install dependencies and test

```bash
pnpm install
cd packages/tools/my-tool && pnpm exec tsc --noEmit
```

### 7. Validate your manifest

```typescript
import { validateToolManifest } from '@larkup/marketplace/manifest';
import manifest from './tool.manifest.json';

const result = validateToolManifest(manifest);
if (!result.valid) console.error(result.errors);
if (result.warnings.length) console.warn(result.warnings);
```

## Using a Tool at Runtime

Tools are loaded dynamically via `@larkup/marketplace/loader`:

```typescript
import { loadTool } from '@larkup/marketplace/loader';

const myTool = await loadTool<typeof import('@larkup/tool-my-tool')>('my-tool');
if (myTool) {
  await myTool.doSomething();
}
```

## Key Conventions

1. **Manifest file**: Every tool MUST ship a `tool.manifest.json`. The registry discovers tools by reading these files.
2. **Optional dependencies**: If your tool has optional npm dependencies (e.g., `nodejs-whisper`), use dynamic `import()` with a try/catch and create a `.d.ts` type declaration file.
3. **System deps**: Declare system requirements (ffmpeg, etc.) in `systemDeps` — the installer checks these before installing.
4. **Config schema**: Use `configSchema` to define user-configurable options. The installer auto-generates defaults from `defaultValue`.
5. **Emoji icons**: Prefer emoji (`emoji` field) for icon display. Only use `iconUrl` for branded images or `icon` for Lucide fallback.
6. **Publishable**: Tool packages are NOT `"private": true` — they are designed to be published to npm as standalone packages.
7. **Peer dep on marketplace**: Use `@larkup/marketplace` as a peer dependency, not a hard dependency. This avoids forcing a specific version on consumers.
