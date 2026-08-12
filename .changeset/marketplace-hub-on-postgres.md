---
'@larkup/hub-db': minor
'@larkup/hub': minor
---

feat(hub): move the Marketplace catalog from in-memory to Postgres (TASK 03)

`apps/hub`'s catalog — publisher identity, extension versions, install
counts — lived in a `Map`. Every restart lost everything published.

**New package `@larkup/hub-db`**: Drizzle schema (`publishers`,
`extensions`, `extension_versions`, `extension_workspace_grants`,
`workspace_installations`, `audit_events`), committed migrations, a lazy
Postgres connection factory, and every query the Hub API needs as a typed
`repo.ts` function — `apps/hub` owns no SQL. Manifest validation on publish
(previously only `id`/`packageName` were checked), version immutability
(republishing `id@version` is now rejected, not overwritten), and
first-publish ownership (a different publisher can't take over an existing
listing) are new, real guarantees.

**Local contributor path, no Neon account needed**:
`docker compose -f docker/hub-db.yml up`, then `pnpm --filter @larkup/hub-db
migrate && pnpm --filter @larkup/hub-db seed`. `apps/hub/.env`'s
`DATABASE_URL` stays gitignored and reachable only by the deployed service.

**`@larkup/hub`**: `/v1/*` stays byte-compatible — every response is
reconstructed from the stored manifest so `ToolDescriptor`/`ToolListResponse`/
`ToolDetailResponse` are unchanged field-for-field, and
`POST /v1/tools/:id/installed` still accepts the body-less request
`packages/marketplace`'s installer sends today (falls back to an
`"anonymous"` workspace bucket; a caller sending `workspaceId` gets accurate
per-workspace install tracking with no Hub change required).

See [ADR-012](docs/adrs/adr-012-marketplace-hub-on-postgres.md) for the
schema-scope decision (six of plan §7.4's eleven entities — the other five
have no caller yet) and the Drizzle/connection/authorization design.
