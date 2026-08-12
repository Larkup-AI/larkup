# Coupling Inventory

**Date:** 2026-08-10  
**Purpose:** Document current architectural coupling to guide migration decisions.

## 1. Central chat route — `apps/web/app/api/chat/tools.ts`

**Status:** MIGRATE (TASK 02 → TASK 04)

**Problem:** Every tool (retrieval, video knowledge, document editing, sandbox, tabular, web search, image analysis) is hardcoded in a single 1335-line file. Adding a new tool requires editing this file.

**Current coupling:**
- Imports from: `@larkup/core`, `@larkup/vector-stores`, `@larkup/sandbox`, `@larkup/tool-doc-editor`, `@larkup/marketplace`, video-knowledge modules
- Directly constructs AI SDK `tool()` instances with inline Zod schemas
- Contains tool-specific caching (`queryVideoKnowledgeCache`)
- Mixes retrieval logic with tool logic

**Migration plan:**
- TASK 02: Mark as legacy. Add `loadDynamicTools()` seam.
- TASK 04: Agent Runtime owns tool discovery via manifest/lockfile. This file remains for backward compatibility with the existing dashboard chat.

---

## 2. Credential storage in browser localStorage

**Status:** REMOVE (TASK 01)

**Problem:** `deploy-sheet.tsx` stores sensitive credentials in browser `localStorage`:

| localStorage key | What's stored | Risk |
|------------------|---------------|------|
| `vercel_token` | Vercel API token | Full Vercel account access |
| `rag_server_api_key` | Server API key | Full server admin access |
| `vercel_project_{id}` | Vercel project name | Low risk |
| `vercel_deployed_url_{id}` | Deployed URL | Low risk |
| `rag_server_env_vars_{id}` | Server env vars (JSON) | May contain API keys |

**Functions involved:**
- `persistApiKey()` — writes to `localStorage`
- `GLOBAL_TOKEN_KEY` — reads Vercel token from `localStorage`
- `serverEnvKey()` — stores env vars per server

**Migration plan:**
- Move credentials to server-side storage (`.larkup/credentials.json` via API routes)
- Clear localStorage on first load after migration
- Deploy-sheet reads/writes via `/api/config/credentials` route

---

## 3. Deployment locked to Vercel + SSH

**Status:** KEEP + EXPAND (TASK 01 → TASK 08)

**Problem:** The deploy flow has two paths: Vercel (via `apps/web/app/actions/vercel.ts`) and SSH (via `apps/web/app/api/deploy/ssh/route.ts`). Both work but are tightly coupled to their providers.

**Current state:**
- `deploy-sheet.tsx` (1045 lines) — orchestrates Vercel deploy with indexing
- `deploy-button.tsx` — entry point for deploy action
- `apps/web/app/actions/vercel.ts` — Vercel SDK deployment
- `apps/web/app/api/deploy/ssh/route.ts` — SSH/VPS deployment
- `apps/web/app/api/deploy/cloud-project/route.ts` — Cloud project management

**Migration plan:**
- Keep Vercel + SSH as working paths
- Add Docker zip download (TASK 01)
- Add Cloud Run deployment (TASK 08)
- Gate Vercel on durable storage (TASK 01)
- Abstract deploy targets behind a provider interface (TASK 08)

---

## 4. Agent server embeds Knowledge Server code

**Status:** MIGRATE (TASK 04)

**Problem:** `generate-agent-server.ts` contains a full copy of the LanceDB store, embedding, and document management code. It does not consume an external Knowledge Server — it IS a Knowledge Server plus Agent.

**Files:** `packages/core/src/generator/generate-agent-server.ts` (1102 lines)

**Migration plan:**
- TASK 04: Refactor so Agent Server connects to a Knowledge Server via `LarkupClient` with a `retrieval`-scoped key
- OR: includes a read-only snapshot of indexed data from the AgentRelease (for offline/embedded deployments)

---

## 5. Video/Audio tool-specific chat renderers

**Status:** KEEP (dashboard) + ADAPT (deployed widget)

**Problem:** Video/Audio results use bespoke React components in `apps/web/components/chat/tools/`. These work well in the dashboard but cannot run in the deployed Widget.

**Files:**
- `apps/web/components/chat/tools/` — custom renderers
- `apps/web/lib/video-intelligence/` — video intelligence utilities
- `apps/web/lib/media-knowledge.ts` — citation helpers

**Migration plan:**
- TASK 02: Map video results to `AgentOutputBlock` types
- Dashboard keeps existing custom renderers for first-party tools
- Deployed Widget uses generic output block rendering
- No video behavior changes

---

## 6. Widget style coupled to deployment config

**Status:** MIGRATE (TASK 04 → TASK 05)

**Problem:** `AgentWidgetStyle` is defined in `packages/core/src/types.ts` alongside `AgentDeploymentConfig`. Widget configuration should be part of the Agent definition, not the deployment config.

**Migration plan:**
- TASK 04: Move widget style into `AgentDefinition` (part of the AgentRelease)
- TASK 05: Widget reads style from the AgentRelease it's connected to

---

## 7. Marketplace state is in-memory

**Status:** KEEP for MVP, MIGRATE in TASK 03

**Problem:** Hub (`apps/hub`) uses in-memory state. Not relevant for MVP tasks (03 is excluded), but noted for awareness.

**Migration plan:** TASK 03 adds Neon/Postgres. Not in MVP scope.
