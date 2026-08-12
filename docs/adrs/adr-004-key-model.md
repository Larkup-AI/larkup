# ADR-004: Key Model and Endpoint-to-Scope Table

**Status:** Accepted  
**Date:** 2026-08-10  
**Decision makers:** Product owner, maintainers  

## Context

The current system uses a single `SERVER_API_KEY` environment variable with no scope differentiation. The deploy sheet stores Vercel tokens and API keys in browser `localStorage`, which is a security vulnerability. There is no distinction between a key that should only query and a key that can modify the knowledge base.

## Decision

**Scoped keys with a single key per credential. Server enforces scope. SDK accepts one `apiKey`. No secrets in browser code or localStorage.**

### Key types

| Credential | Holder | Purpose | Scope |
|------------|--------|---------|-------|
| Publishable Agent ID | Browser/widget | Identify a public agent | No admin access |
| Secret Agent API key | Customer's backend | Call the Agent API | Server-to-server |
| Retrieval key | Agent Runtime → Knowledge Server | Query/chat only | `retrieval` |
| Ingest key | CLI, trusted indexing clients | Upload, index, manage docs | `ingest` |
| Admin key | Workspace operator | All operations + deploy | `admin` |

### Endpoint-to-scope table

This is the authoritative access control matrix for the generated Knowledge Server:

| Endpoint | `retrieval` | `ingest` | `admin` | No key |
|----------|:-----------:|:--------:|:-------:|:------:|
| `GET /health` | ✅ | ✅ | ✅ | ✅ |
| `GET /readiness` | ✅ | ✅ | ✅ | ✅ |
| `POST /query` | ✅ | ✅ | ✅ | ❌ |
| `POST /chat` | ✅ | ❌ | ✅ | ❌ |
| `GET /documents` | ❌ | ✅ | ✅ | ❌ |
| `GET /documents/:id` | ❌ | ✅ | ✅ | ❌ |
| `POST /documents` | ❌ | ✅ | ✅ | ❌ |
| `PUT /documents/:id` | ❌ | ✅ | ✅ | ❌ |
| `DELETE /documents/:id` | ❌ | ✅ | ✅ | ❌ |
| `POST /scrape` | ❌ | ✅ | ✅ | ❌ |
| `GET /corpus/*` | ❌ | ❌ | ✅ | ❌ |
| `POST /corpus/*` | ❌ | ❌ | ✅ | ❌ |
| `GET /media/*` | ❌ | ✅ | ✅ | ❌ |
| Deploy / config | ❌ | ❌ | ✅ | ❌ |

### Key format

Environment variable:
```
SERVER_API_KEYS=retrieval:rk_abc123,ingest:ik_def456,admin:ak_ghi789
```

Auth middleware parses `Authorization: Bearer <key>`, looks up the scope, and checks against the endpoint table. Unknown keys are rejected with `401`. Keys with insufficient scope return `403`.

### SDK design

The SDK accepts a single `apiKey`. The server determines scope:

```ts
// Knowledge Server client
const ks = new LarkupClient({ baseUrl: '...', apiKey: 'rk_abc123' });

// Agent client  
const agent = new LarkupAgentClient({ baseUrl: '...', apiKey: 'sk_def456' });
```

No `ingestKey` / `readKey` split in the SDK surface. One key, server enforces scope.

### Credential storage migration

**Current (insecure):** `localStorage` stores `vercel_token`, `rag_server_api_key`, per-server env vars.

**Target:** Server-side storage in the workspace data directory (`.larkup/credentials.json`, encrypted at rest). Dashboard reads/writes via API routes. `localStorage` is cleared during migration.

## Consequences

- **Positive:** An Agent can only query, never modify the knowledge base.
- **Positive:** No secrets in browser code, localStorage, or generated widget snippets.
- **Positive:** Simple SDK surface — one key per client.
- **Trade-off:** Breaking change for users who configured `SERVER_API_KEY` as a single value. Migration path: single key without `scope:` prefix is treated as `admin` for backward compatibility.
