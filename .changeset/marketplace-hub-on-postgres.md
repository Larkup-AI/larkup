---
'@larkup/marketplace': minor
'@larkup/hub': minor
---

feat(marketplace): add a durable Postgres catalog

`apps/marketplace` now stores publisher identity, extension versions, install
counts, and audit events in Postgres.

**`@larkup/marketplace`** now includes the Drizzle schema, committed
migrations, a lazy Postgres client, and typed catalog queries under `src/db`.
The Hub owns HTTP handling while the Marketplace package owns database access.
Publishing validates manifests, preserves immutable versions, and enforces
publisher ownership.

**Local contributor path, no Neon account needed**:
`docker compose -f docker/marketplace-db.yml up`, then `pnpm --filter
@larkup/marketplace db:migrate && pnpm --filter @larkup/marketplace db:seed`.

**`@larkup/hub`**: `/v1/*` stays byte-compatible — every response is
reconstructed from the stored manifest so `ToolDescriptor`/`ToolListResponse`/
`ToolDetailResponse` are unchanged field-for-field, and
`POST /v1/tools/:id/installed` still accepts the body-less request
`packages/marketplace`'s installer sends today (falls back to an
`"anonymous"` workspace bucket; a caller sending `workspaceId` gets accurate
per-workspace install tracking with no Hub change required).

See [ADR-012](docs/adrs/adr-012-marketplace-hub-on-postgres.md) for the
schema and authorization design.
