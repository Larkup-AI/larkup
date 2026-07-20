---
name: marketplace-hub-guide
description: Guide for deploying the Larkup Hub and integrating marketplace tools with AI Agents. Covers Hub architecture, deployment steps, and agent portability concepts.
tags: marketplace, hub, agents, deployment, portability
---

# Hub Deployment & Agent Integration Guide

This guide explains the architecture of the Larkup Hub (`apps/hub`), how to deploy it, and the next steps for connecting installed marketplace tools directly to our AI agents for true portability.

## 1. Hub Architecture

The **Larkup Hub** is the central catalog API for marketplace tools. It operates independently from the main web application (`apps/web`) to allow for separate scaling, caching, and CI publishing cycles.

### Components
- **Runtime:** Hono (lightweight HTTP framework).
- **Deployment Target:** Vercel Serverless Edge Functions.
- **Data Store (`src/store.ts`):** Currently in-memory (seeded on cold start) but designed to be backed by **Turso (SQLite)** in the future.
- **Core Endpoints:**
  - `GET /v1/tools`: Paginated catalog with category and search filtering.
  - `GET /v1/tools/:id`: Tool details and version history.
  - `POST /v1/tools/:id/installed`: Fire-and-forget install tracker.
  - `GET /v1/tools/:id/install.sh`: A shell script for curl-based installations (`curl -sL hub.larkup.dev/v1/tools/doc-editor/install.sh | sh`).
  - `POST /v1/tools/publish`: CI webhook to publish/update tools.

## 2. Tool Packaging & Portability

Larkup tools are no longer internal workspace packages (`"private": true`). They are now **standalone npm packages** that can be published to the public npm registry or a private registry.

### The Isolated Install Directory
When a user clicks "Install" in the UI, the marketplace installer runs a real `npm install` into a sandboxed directory:

```
.larkup/tools/
├── package.json             ← Auto-generated
├── installed.json           ← Manifest of installed tools & config
└── node_modules/
    └── @larkup/tool-xyz/
```

**Why this matters for Agents:** This isolated folder represents the agent's "toolbelt". Because it doesn't pollute the main monorepo `package.json`, this entire folder can be zipped up, moved to a VPS, or mounted into a Docker container.

## 3. Deployment Steps (Going Live)

To make the Hub and tools publicly available, follow these steps:

### A. Publish Tools to npm
Before tools can be installed from outside the monorepo, they must be published.
```bash
# Test the package first
pnpm --filter @larkup/tool-video-audio pack --dry-run

# Publish
pnpm --filter @larkup/tool-video-audio publish --access public
```
*(Repeat for `doc-editor` and `clip-embeddings`)*

### B. Deploy the Hub
Deploy the Hub app to Vercel.
```bash
cd apps/hub
vercel deploy --prod
```

### C. Configure the Web App
Once the Hub is deployed (e.g., `https://hub.larkup.dev`), point the main application to it by setting the environment variable in `apps/web`:
```env
LARKUP_HUB_URL="https://hub.larkup.dev"
```

## 4. Next Steps: Agent Connections & Deployability

Now that tools are portable npm packages, the next major feature is **deploying agents with their installed tools**.

When a user creates a custom AI server (agent) and deploys it, the agent needs access to the tools the user installed.

### How the Agent Uses Tools
During runtime, the agent uses `@larkup/marketplace/loader` to dynamically import tools:
```typescript
import { loadTool, isToolLoaded } from "@larkup/marketplace/loader"

const docEditor = await loadTool("doc-editor");
if (docEditor) {
  // Execute tool logic
}
```

### Deployment Strategy for Agents
When generating the deployment artifact for an agent, we need to ensure its tools are included:

1. **Docker Deployment:**
   - Copy `.larkup/tools/installed.json` into the agent's Docker build context.
   - During the Docker `RUN` step, execute the installer to reconstruct the `node_modules` inside the container:
     ```dockerfile
     # Inside the agent's Dockerfile
     COPY .larkup/tools/installed.json .larkup/tools/installed.json
     RUN node scripts/restore-tools.js
     ```

2. **Serverless Sandbox (E2B / Modal):**
   - The installer has a `DeploymentTarget = 'sandbox'` mode.
   - When the agent boots in the sandbox, it can read its required tools and dynamically run `npm install` inside the ephemeral environment before executing the task.

3. **Wiring Tools to the LLM:**
   - The agent should read `installed.json` to know which tools to present to the LLM.
   - Map the `capabilities` array in each tool's `tool.manifest.json` to the corresponding AI SDK tool definitions (e.g., passing the tool's description and JSON schema to the LLM).
