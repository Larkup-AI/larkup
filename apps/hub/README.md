# Larkup Hub

The **Larkup Hub** is the marketplace catalog API for the Larkup ecosystem. It serves tool manifests, tracks install counts, and provides endpoints for tool publishing and discovery.

## Architecture

- **Runtime:** Hono (lightweight HTTP framework)
- **Deployment:** Vercel Serverless Functions
- **Storage:** In-memory (MVP) → Turso (SQLite) for persistence
- **CDN:** Vercel Edge for catalog caching

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check |
| `GET` | `/v1/tools` | List all tools (supports `?category=`, `?search=`, `?page=`, `?limit=`) |
| `GET` | `/v1/tools/:id` | Get tool details + version history |
| `POST` | `/v1/tools/:id/installed` | Track install count (fire-and-forget) |
| `GET` | `/v1/tools/:id/install.sh` | Curl-installable shell script |
| `POST` | `/v1/tools/publish` | Publish/update a tool (CI webhook) |
| `GET` | `/v1/schema/tool-manifest.v1` | JSON Schema for `tool.manifest.json` |

## Local Development

```bash
pnpm install
pnpm --filter @larkup/hub dev
```

## Deployment

```bash
cd apps/hub
vercel deploy
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `HUB_PUBLISH_KEY` | API key for CI publish webhook | Optional (MVP) |

## Future: Turso Migration

The in-memory store (`src/store.ts`) is designed for easy migration to Turso:

```sql
CREATE TABLE tools (
  id          TEXT PRIMARY KEY,
  manifest    TEXT NOT NULL,     -- JSON blob
  npm_package TEXT NOT NULL,
  version     TEXT NOT NULL,
  installs    INTEGER DEFAULT 0,
  published_at TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE tool_versions (
  tool_id     TEXT NOT NULL,
  version     TEXT NOT NULL,
  manifest    TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY (tool_id, version)
);
```
