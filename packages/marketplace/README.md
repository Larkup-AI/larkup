# @larkup/marketplace

Marketplace discovery, installation, loading, storage, and catalog database
utilities for Larkup.

## Package exports

Use `@larkup/marketplace/registry` to discover tools, `installer` to install
them, `loader` to load an installed tool, and `storage` for tool storage.

The Marketplace Hub uses the database exports under `@larkup/marketplace/db`.
They provide the Postgres client, schema, repository functions, manifest
validation, and built in tool manifests.

## Local Marketplace database

Start the local database and copy the example environment file:

```bash
docker compose -f docker/marketplace-db.yml up -d
cp packages/marketplace/.env.example packages/marketplace/.env
```

Use the following commands from the repository root:

```bash
pnpm --filter @larkup/marketplace db:migrate
pnpm --filter @larkup/marketplace db:seed
pnpm --filter @larkup/marketplace db:test
pnpm --filter @larkup/marketplace db:typecheck
```

Database migrations are committed in `db/drizzle`. Add a migration whenever a
schema change is made.
