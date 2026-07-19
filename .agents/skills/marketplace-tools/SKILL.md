---
name: marketplace-tools
description: Guide for adding new marketplace tools/plugins to the Larkup ecosystem. Covers the manifest schema, package structure, registry, loader, and testing.
tags: marketplace, tools, plugins, schema
---

# Adding Marketplace Tools

## Overview

The Larkup Marketplace is a plugin system that allows extending the platform with optional tools. Each tool is a standalone workspace package under `packages/tools/` that registers itself in the central tool registry.

## Architecture

```
packages/marketplace/         ← Core marketplace system
  src/types.ts               ← ToolDescriptor schema, types
  src/tool-registry.ts       ← Hardcoded registry of all tools
  src/tool-installer.ts      ← Install/uninstall logic, download tracking
  src/tool-loader.ts         ← Dynamic runtime loader
  src/tool-manifest.schema.ts ← Schema validator for manifests
  src/storage-provider.ts    ← Media storage abstraction

packages/tools/              ← Individual tool packages
  video-audio/               ← Example: Video & Audio processing
  clip-embeddings/           ← Example: CLIP image search (coming soon)

apps/web/
  components/settings/marketplace-section.tsx  ← Marketplace UI
  app/api/marketplace/route.ts                 ← API: list tools
  app/api/marketplace/[toolId]/route.ts        ← API: install/uninstall
```

## ToolDescriptor Schema (v1.0)

Every tool must conform to the `ToolDescriptor` interface from `@larkup/marketplace/types`:

```typescript
interface ToolDescriptor {
  id: string                    // Unique ID: "my-tool" (lowercase, hyphenated)
  name: string                  // Display name: "My Tool"
  description: string           // One-line description
  longDescription?: string      // Detailed description for detail view
  category: ToolCategory        // "media" | "search" | "analytics" | "integration" | "embedding" | "ai" | "automation" | "utility"
  version: string               // Semver: "0.1.0"
  pricing: ToolPricing          // "free" | "pro" | "enterprise"

  // Icon (priority: emoji > iconUrl > icon)
  emoji?: string                // Emoji icon: "🎬"
  iconUrl?: string              // Custom image URL (future: CDN)
  icon: string                  // Lucide icon name fallback

  packageName: string           // npm package: "@larkup/tool-my-tool"
  installSize: string           // Display size: "~15 MB"
  systemDeps?: string[]         // System requirements: ["ffmpeg"]
  author: string                // Publisher name
  capabilities: string[]       // Feature keys used by core routing
  configSchema?: ToolConfigField[] // User-configurable options
  tags?: string[]               // Search tags
  downloads: number             // Install count (start at 0)
  repositoryUrl?: string        // GitHub/homepage URL
  license?: string              // "MIT", "Apache-2.0"
  updatedAt?: string            // ISO date of last update
  comingSoon?: boolean          // If true, shown but not installable
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
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@larkup/core": "workspace:*",
    "@larkup/marketplace": "workspace:*"
  },
  "devDependencies": {
    "typescript": "5.7.3"
  }
}
```

### 2. Implement the tool

Create `packages/tools/my-tool/src/index.ts`:

```typescript
export const TOOL_META = {
  id: "my-tool",
  name: "My Tool",
  version: "0.1.0",
} as const

// Export your tool's public API
export async function doSomething(): Promise<void> {
  // Implementation
}
```

### 3. Register in the tool registry

Add an entry in `packages/marketplace/src/tool-registry.ts`:

```typescript
"my-tool": {
  id: "my-tool",
  name: "My Tool",
  description: "Short description of what this tool does.",
  category: "utility",
  version: "0.1.0",
  pricing: "free",
  emoji: "🔧",
  icon: "Wrench",
  packageName: "@larkup/tool-my-tool",
  installSize: "~5 MB",
  author: "Your Name",
  capabilities: ["my-capability"],
  tags: ["keyword1", "keyword2"],
  downloads: 0,
  repositoryUrl: "https://github.com/...",
  license: "Apache-2.0",
  updatedAt: "2026-07-19",
},
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
import { Wrench } from "lucide-react";
const ICON_MAP: Record<string, LucideIcon> = {
  Film,
  ScanEye,
  Wrench,  // ← Add your icon
};
```

### 6. Install dependencies and test

```bash
pnpm install
cd packages/tools/my-tool && pnpm exec tsc --noEmit
```

### 7. Validate your manifest (optional)

```typescript
import { validateToolManifest } from "@larkup/marketplace/manifest"

const result = validateToolManifest({
  id: "my-tool",
  name: "My Tool",
  // ... all fields
})

if (!result.valid) console.error(result.errors)
if (result.warnings.length) console.warn(result.warnings)
```

## Using a Tool at Runtime

Tools are loaded dynamically via `@larkup/marketplace/loader`:

```typescript
import { loadTool } from "@larkup/marketplace/loader"

const myTool = await loadTool<typeof import("@larkup/tool-my-tool")>("my-tool")
if (myTool) {
  await myTool.doSomething()
}
```

## Key Conventions

1. **Optional dependencies**: If your tool has optional npm dependencies (e.g., `nodejs-whisper`), use dynamic `import()` with a try/catch and create a `.d.ts` type declaration file.
2. **System deps**: Declare system requirements (ffmpeg, etc.) in `systemDeps` — the installer checks these before installing.
3. **Config schema**: Use `configSchema` to define user-configurable options. The installer auto-generates defaults from `defaultValue`.
4. **Emoji icons**: Prefer emoji (`emoji` field) for icon display. Only use `iconUrl` for branded images or `icon` for Lucide fallback.
5. **Downloads**: Start at `0` in the registry. The installer auto-increments locally. Future: server-side tracking via API gateway.
