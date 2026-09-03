# Larkup Hub

The **Larkup Hub** is the marketplace catalog API for the Larkup ecosystem. It serves tool manifests, tracks install counts, and provides endpoints for tool publishing and discovery.

## Architecture

- **Runtime:** Hono (lightweight HTTP framework)
- **Deployment:** Vercel Serverless Functions
- **Storage:** Neon Postgres through `@larkup/marketplace/db`; catalog entries,
  versions, publishers, workspace installs, and audit events persist across
  serverless invocations.
- **CDN:** Vercel Edge for catalog caching

## API Endpoints

| Method | Path                          | Description                                                             |
| ------ | ----------------------------- | ----------------------------------------------------------------------- |
| `GET`  | `/`                           | Health check                                                            |
| `GET`  | `/v1/tools`                   | List all tools (supports `?category=`, `?search=`, `?page=`, `?limit=`) |
| `GET`  | `/v1/tools/:id`               | Get tool details + version history                                      |
| `POST` | `/v1/tools/:id/installed`     | Track install count (fire-and-forget)                                   |
| `GET`  | `/v1/tools/:id/install.sh`    | Curl-installable shell script                                           |
| `POST` | `/v1/tools/publish`           | Publish/update a tool (CI webhook)                                      |
| `GET`  | `/v1/schema/tool-manifest.v1` | JSON Schema for `tool.manifest.json`                                    |

## Local Development

```bash
pnpm install
docker compose -f docker/marketplace-db.yml up -d
cp packages/marketplace/.env.example packages/marketplace/.env
pnpm --filter @larkup/marketplace db:migrate
pnpm --filter @larkup/marketplace db:seed
pnpm --filter @larkup/hub dev
```

The local database commands, contract tests, and development server use
`packages/marketplace/.env`. Keep deployment credentials in your hosting
provider rather than committing them to this repository.

## Deployment

```bash
cd apps/marketplace
vercel deploy
```

## Environment Variables

| Variable          | Description                                      | Required          |
| ----------------- | ------------------------------------------------ | ----------------- |
| `DATABASE_URL`    | Neon/Postgres connection URL for the Hub catalog | Yes               |
| `HUB_PUBLISH_KEY` | API key for CI publish webhook                   | Yes in production |

## Sandbox requirement

Every tool manifest supports `requiresSandbox`. It defaults to `true` when
omitted, so a publisher must explicitly set it to `false` only when the tool
is safe to execute in the host process. The Hub persists this flag in the
catalog row, returns it from `/v1/tools`, and the marketplace displays it
before installation.

## Collaboration and subscriptions

The Hub models publisher ownership, immutable versions, public/private
distribution, and workspace grants. This is the collaboration foundation:
private extensions are only visible to granted workspaces, and every publish
or installation is recorded in the audit log. Subscription entitlements should
be added as a dedicated billing layer keyed by publisher, workspace, and plan;
the marketplace must enforce an entitlement before handing an install token to
a paid/private package registry.
