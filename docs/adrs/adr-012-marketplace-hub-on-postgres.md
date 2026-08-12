# ADR-012: Marketplace (Hub) Catalog on Postgres via Drizzle

**Status:** Accepted
**Date:** 2026-08-12
**Decision makers:** Product owner, maintainers
**Closes:** TASK 03 (plan §7, §15). Confirms the ORM choice ADR-008 deferred.

## Context

`apps/hub`'s catalog — publisher identity, extension versions, install
counts — lived in a `Map` inside `apps/hub/src/store.ts`. Every restart lost
the catalog, every install count, and every published manifest. TASK 03's
job was to give it durable storage without breaking the `/v1/*` contract the
CLI and both SDKs call directly, and without inventing a second way for
contributors to reach a database they should never hold credentials for.

ADR-008 already settled *where* the data lives (Neon/Postgres, separate from
the future Cloud control-plane database) and the collaboration model (no
contributor gets the production connection string). What was still open: the
schema, the ORM, and how much of plan §7.4's entity list to build now versus
when something actually needs it.

## Decision

### 1. Drizzle, not Prisma

No binary engine, no generate step, and the schema is reviewable TypeScript
in the repo rather than a separate DSL — `drizzle-kit generate` turns a
schema diff into a committed SQL migration a reviewer reads like any other
code change. This was already the agreed direction per the TASK 03 card;
this ADR is where it becomes the record.

### 2. `packages/hub-db` owns every query; `apps/hub` owns none

```
packages/hub-db/
  src/schema/*.ts     tables — publishers, extensions, extension_versions,
                       extension_workspace_grants, workspace_installations,
                       audit_events
  src/repo.ts          every query the API needs, typed
  src/validate.ts       manifest validation (was: unchecked beyond id+packageName)
  src/client.ts         lazy connection factory (see §4)
  drizzle/*.sql         generated, committed migrations
apps/hub/
  src/index.ts          HTTP routes only — calls repo.ts, no SQL
```

A contributor reviews a schema change and its access pattern in one package.
`apps/hub`'s route handlers are a thin translation layer: parse the request,
call a `repo.ts` function, shape the response.

### 3. Six tables now, not eleven

Plan §7.4 lists eleven entities. Six are built: `publishers`, `extensions`,
`extension_versions`, `extension_workspace_grants`, `workspace_installations`,
`audit_events`. Five are deliberately **not** built yet: `entitlements`,
`plans`, `subscriptions`, `usage_events`, `webhook_deliveries`,
`publisher_keys`.

Why: nothing in the codebase produces or consumes them. There is no billing
system, no publisher-scoped key issuance, no webhook delivery pipeline —
building their tables now would be schema with no code ever touching it,
which is worse than not having the schema, because it looks like a
capability that exists. This is the same call TASK 02's card made about the
video/audio legacy-adapter parity work: an empty placeholder is a false
signal, not progress. `entitlements`/`plans`/`subscriptions` are TASK 09's
monetization work by plan's own sequencing (§1 "Open work" table: TASK 09
"Requires 03 and 08 complete first"); `publisher_keys` needs a real
per-publisher auth model, which does not exist today (`HUB_PUBLISH_KEY`
remains one shared secret — see §5). Add each table in the task that gives it
a caller.

`extension_visibility` and `entitlements`'s public/private distinction is
folded into `extensions.distribution` (`'public' | 'private'`) plus
`extension_workspace_grants`, rather than a separate table — one enum column
and one grants table cover exactly the two distribution modes the Hub can
enforce today (see §7.3: bring-your-own-local is a client-side manifest/path
concept that never reaches the Hub, so there is nothing for a table to
represent; commercial/entitled distribution is TASK 09).

### 4. Connection: lazy, TCP, `postgres.js`

`apps/hub/vercel.json` declares no edge runtime, so `apps/hub` runs as a
standard Vercel Node.js function — a plain TCP Postgres connection
(`postgres.js`) works there and against local Docker identically, unlike the
HTTP-based Neon serverless driver, which would have forced two different
client implementations for local versus deployed.

`getHubDb()` is a lazy, cached factory, not a module-level connection
established on import. This is not just tidiness: a module-level `const db =
getHubDb()` at the top of `apps/hub/src/index.ts` reads `DATABASE_URL` the
instant anything imports that file — including a test file that needs to
load a *different*, explicitly local env file first (see `apps/hub/src/index.test.ts`'s
comment) before any connection is attempted. Making the read lazy turned a
fragile import-order dependency into a non-issue.

### 5. Authorization: application-level, not Postgres RLS

Plan §7.4 asks for "row-level workspace authorization." This is enforced in
`repo.ts`'s query functions (a `workspaceId` parameter filters what comes
back), not with Postgres `ROW LEVEL SECURITY` policies. Real RLS earns its
complexity when an untrusted principal can issue raw SQL against the
database and the database itself has to be the enforcement boundary. That is
exactly the scenario plan §7.1 rules out: "the database never exposed
outside the Hub's HTTP API." Every query already runs as `repo.ts`'s own
trusted code; the visibility filter is real, and it does not need a second,
database-level copy of the same rule to defend against a caller that cannot
reach the database in the first place.

### 6. Ownership and immutability, registry-style

- **Publish** validates the manifest (`validate.ts` — every field
  `GET /v1/schema/tool-manifest.v1` already documented, now actually
  checked, not just a schema nobody enforced against).
- **A version is immutable.** Republishing `id@version` is rejected
  (`VersionExistsError`), not silently overwritten — append a new version
  instead, matching how `AgentRelease` (ADR-002) already treats a published
  artifact in this codebase.
- **Ownership follows first publish**, like a package registry: a second
  publish under the same `id` from a different publisher is rejected
  (`NotOwnerError`) rather than taking over an existing listing.
- **Provenance is an integrity hash, not a signature.** `extension_versions.integrity`
  is a server-computed SHA-256 of the submitted manifest — tamper-evidence
  for "did this change," not a publisher-signed chain of custody. Real
  provenance needs publisher-held signing keys, which is the same
  `publisher_keys` gap deferred in §3.
- **Publisher identity today is `manifest.author`, slugified.** `HUB_PUBLISH_KEY`
  is still one shared secret (unchanged from before this migration) — there
  is no per-publisher credential to authenticate against yet, so ownership
  enforcement is a real integrity check (stops one manifest from
  accidentally colliding with another's `id`) but not yet a security
  boundary between publishers. Closing that gap is exactly what
  `publisher_keys` is for.

### 7. `/v1/*` stays byte-compatible

Every response is reconstructed from the stored manifest JSON
(`extension_versions.manifest`) merged with a live-computed `downloads`
count, so `ToolDescriptor`/`ToolListResponse`/`ToolDetailResponse` are
unchanged field-for-field. `POST /v1/tools/:id/installed` still accepts a
body-less request (what `packages/marketplace`'s installer sends today) and
falls back to an `"anonymous"` workspace bucket; a caller that starts
sending `workspaceId` gets accurate per-workspace installs with no Hub
change required.

## Consequences

**Positive**

- Restart-safe: publish, install counts, and version history survive a
  redeploy — the literal problem this task existed to fix.
- A contributor with no Neon account runs `packages/hub-db`'s and
  `apps/hub`'s full test suites against a throwaway container
  (`docker/hub-db.yml`).
- Manifest validation and version immutability are new, real guarantees the
  in-memory store never had.

**Negative**

- `HUB_PUBLISH_KEY` being one shared secret means ownership enforcement is
  integrity, not authentication, between publishers — acceptable while the
  Hub has no external publishers yet (plan §7's "do not accept third-party
  submissions until TASK 03 is complete" is about durability, and closing
  the loop on *who* may publish is `publisher_keys`, explicitly deferred).
- Neon branch-per-PR automation (the TASK 03 card's `neon branches create`
  flow) needs `NEON_API_KEY`, which is not in `apps/hub/.env` yet. Documented
  as the next step in CONTRIBUTING.md; not blocking, since the local-Postgres
  path needs no Neon access at all.
- Five §7.4 entities do not exist. Each is named above with the task that
  will need it, so the gap is a decision, not an oversight to rediscover.
