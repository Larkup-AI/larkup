# Handoff prompt — finish §1–§11 of plan.md

**Short version to paste in a new session:**

> Read `plan.md` and `.claude/HANDOFF.md`, then execute the handoff in order:
> fix the two standing TypeScript errors (step 0), then rate limiting (§8.5),
> then TASK 03 / §7 Marketplace on Neon with Drizzle, then §10 proxy cleanup,
> then §9 Slack, then close §3 and §5. Skip the cloud targets — they are coming
> soon. Follow plan.md's mandatory task workflow and stop at each task's gate.

Everything below the line is the full brief.

---

Read `plan.md` first — all of it, then re-read §7, §8, §9, §10, §11 and the
matching task cards in §15. It is the authoritative spec. Section titles carry a
status marker (✅ done · 🟡 partly done · ⬜ not started); the "Open work, by
task" table near the top lists exactly what is missing.

## Your goal

Take sections **§1 through §11** of `plan.md` to ✅. Today §7 and §10 are ⬜, and
§2, §3, §5, §8, §9, §11 are 🟡. Do not start §12–§15 work beyond what these
require, and do not touch TASK 09 (monetization) — it is explicitly blocked
until §7 and §11 close.

Work in this order. Each item is a focused branch/PR that ends at its own gate.

### 0. Finish the `persistApiKey` migration — small, do it first

`apps/web/components/server/deploy-sheet.tsx:564` calls `persistApiKey(sid, apiKey)`.
**That function does not exist anywhere in the repo** — it is called once and
defined never. It is one of the two standing TypeScript errors and it fails
`e2e/tests/web-ui/04-server.spec.ts › cloud deployments link directly to their API reference`.

This is the tail of TASK 01's "move credentials out of localStorage into
server-side storage". The destination already exists and is working:

- `apps/web/app/api/config/credentials/route.ts` — `GET` / `POST` / `DELETE`.
- `POST` accepts a partial `StoredCredentials`: `vercelToken`, `serverApiKey`,
  `serverEnvVars`, `vercelProjects`, `deployedUrls`, `deployedProviders`, and an
  `isMigration` flag that sets `migratedFromLocalStorage`.
- It merges rather than replaces, so a partial write is safe.

**Do:**

1. Define `persistApiKey(serverId: string, apiKey: string)` in `deploy-sheet.tsx`
   (or lift it to `apps/web/lib/` if `server-section.tsx` needs it too) and have
   it `POST` to `/api/config/credentials`.
2. **Decide and record where a per-server key lives.** `StoredCredentials` has a
   flat `serverApiKey`, but `persistApiKey` takes a `serverId`. Either key it
   per server inside `serverEnvVars` (e.g. `SERVER_API_KEY__<serverId>`) or
   accept that one workspace has one server key and drop the parameter. Do not
   leave the signature implying per-server support that the store does not have.
3. The call site is inside a synchronous `deployEnv` builder. `persistApiKey` is
   async — fire it before building the payload and `await` it, or the deploy can
   race the write.
4. **Update the E2E test.** `04-server.spec.ts` seeds
   `localStorage.setItem('rag_server_api_key', …)` and
   `larkup_api_key_version_${serverId}`. If the server store is now the source of
   truth, the test must seed via `POST /api/config/credentials` instead. If
   localStorage stays as a client-side mirror, say so in a comment and keep it.
5. Fix the second error while you are there:
   `apps/web/components/settings/server-section.tsx:199` —
   `Type 'number' is not assignable to type 'Timeout'`. Type the ref as
   `ReturnType<typeof setTimeout>`.

**Done when** `pnpm exec tsc --noEmit -p apps/web/tsconfig.json` reports **zero**
errors and the full E2E suite is green (it is 253 passing with this one failing
today).

### 1. Rate limiting — §8.5. The real launch blocker.

The only *feature* gap that blocks launch. An allow-listed page with a loop, or a
scraped snippet replayed from a headless browser, spends the operator's model
budget until the provider's quota stops it.

§8.5 specifies the design in full: three limits (requests/min per visitor,
messages per session, daily token/cost ceiling per agent), token bucket rather
than fixed window, `packages/agent-contracts/src/rate-limit.ts` as a pure
interface plus an in-memory implementation, called from
`apps/web/lib/agent-access.ts` inside `authorizeAgentRequest` immediately after
the origin check. Mirror the same check inline in the generated `server.mjs`.

The cost ceiling is the one that matters — `run.completed` already emits
`usage`, so the meter has its input. Return `429` with `Retry-After`; make the
widget render "Too many messages — try again in a minute" rather than a raw
error. Bucket on `hash(agentId + IP + UA)`, and honour `X-Forwarded-For` only
from a trusted hop or the limit is trivially spoofed.

Follow the shape of `IdempotencyStore` in `packages/channels-core` — an
interface with an in-memory default, so Redis or Postgres swaps in later without
touching call sites.

### 2. TASK 03 / §7 — Marketplace on Neon

The full card is in §15 under TASK 03 and includes the agreed approach: Drizzle
(not Prisma), schema in `packages/hub-db`, `apps/hub` owns no SQL, migrations
committed and reviewed, contributors run local Postgres via
`docker compose -f docker/hub-db.yml up`, Neon branching for PR previews, and
the database never exposed outside the Hub's HTTP API.

`apps/hub` is small — 673 lines across `src/index.ts`, `src/store.ts`,
`src/types.ts`, 7 routes under `/v1/*`. This is a contained swap, not a rewrite.
Keep the `/v1/*` route contract byte-compatible; the CLI and both SDKs call it.

`apps/hub/.env` has `DATABASE_URL` provisioned. **Never read its value, never
copy it anywhere.** Inspect variable names only.

**Neon branching.** `NEON_API_KEY` and `NEON_PROJECT_ID` are *not* in `.env`
yet. If they appear, PR preview branches work as documented in the TASK 03 card
(`neon branches create` → `neon connection-string` → `neon branches delete`). If
they are still absent, use the local-Postgres path — it needs no Neon access and
is the path a contributor uses anyway. Do not block on this.

Entities are listed in §7.4. Add row-level workspace authorization and audit
columns. Document the local-Postgres contributor path in `CONTRIBUTING.md`.

### 3. §11 — Docker/VPS only. Cloud targets are COMING SOON — skip them.

**Do not attempt Cloud Run, Azure Container Apps, or AWS App Runner.** The
product owner has decided Larkup launches on **Docker/VPS only**; the other
three are marked "coming soon" in §11 and the acceptance-matrix doc. Their
config, runbooks, and CI workflow are already written and committed, and the
identical image already runs on them — what is missing is *proof*, which needs
cloud credentials that are deliberately not being provisioned yet.

Your job for §11 is therefore narrow: keep Docker/VPS green. Re-run
`scripts/acceptance-matrix.sh` against a locally booted bundle after any change
to the generator or the runtime, and do not promote a target in `plan.md` that
has not passed.

### 4. §10 — larkup-proxy cleanup

Untouched so far. §10 lists it: rename/document consistently as the **Knowledge
Integration OAuth Proxy**, remove any agent/channel assumptions, publish a
deployment guide, threat model, redirect-origin policy and provider
registration checklist, make providers registry-driven, and add contract/E2E
tests for OAuth state, redirect validation, token storage handoff, and denied
consent.

Small and self-contained. Good task to close a whole section.

### 5. §9 — remaining channels

Slack, then WhatsApp, then Discord, in that order. `packages/channels-core`
already owns the dispatch pipeline; each adapter supplies `verify`, `parse`,
`send`, `health` and inherits ordering, de-duplication, the non-streaming
fallback, retries, and events.

Copy the shape of `src/adapters/telegram.ts` and its test file. Slack's
signature scheme (`v0=` HMAC over `v0:timestamp:body`) is close to the generic
webhook's — reuse the timing-safe compare.

### 6. §3 and §5 — close the two remaining 🟡 sections

§3: the package layout lists `packages/agent-runtime`, `packages/agent-sdk`,
`packages/agent-react` which do not exist — the runtime currently lives in
`packages/core/src/agent-runtime.ts`. Either extract them or amend §3 to record
the decision not to. Do not leave the plan describing a layout the repo does not
have.

§5: the product owner has **waived** the legacy-adapter parity work (recorded in
the TASK 02 card). The remaining criterion is only that video search keeps
working. Verify it, then mark §5 accordingly.

## Rules that are not negotiable

These are from plan.md's own "Rules that apply to every task" and the mandatory
delivery workflow. Previous sessions were held to them:

- **Never read or copy a secret.** `.env` files are inspected for variable
  *names* only. Nothing from them reaches source, Markdown, logs, fixtures, or
  commits.
- **Preserve working behaviour.** Add characterization coverage before changing
  legacy code. The video/audio path is the most sensitive.
- **Tests in the same task, not later.** Unit + contract + E2E. Fix tests you
  break rather than leaving them.
- **Sync every affected surface**: CLI, JS SDK, Python SDK, Desktop, generated
  templates, docs. Record explicitly when one is intentionally unchanged.
- **`pnpm changeset`** for every package touched.
- **ADR in `docs/adrs/`** whenever a boundary, contract, or security model
  changes. ADR-009 and ADR-010 are the recent precedent for tone and depth.
- **Prove it locally**: narrowest `pnpm --filter <pkg> <cmd>` first, then
  `pnpm turbo type-check` and `pnpm turbo build`.
- **Stop at the gate.** Finish at the task's "Done when" list; do not silently
  roll into the next task.

## State of the repo you are inheriting

Delivered and verified: TASK 00, 01, 02, 04, 05, 06, 07. TASK 08 is 🟡.

- `pnpm turbo type-check build` — green.
- Full E2E — 253 passing.
- Unit — 81 contract, 60 channels, 34 widget, 24 SDK.

**Two standing errors — fix them, do not ask.** The product owner has confirmed
they are theirs, that credentials now live in `.env`, and that they want them
resolved. Details and the intended fix are in step 0 above.

**Architecture you must not violate:**

- A channel never talks to a Knowledge Server directly (§1.1, §3.2). It produces
  a normalized message and hands it to the Agent Runtime.
- The browser gets a public Agent ID and nothing else (ADR-004). No secret ever
  reaches client JavaScript, a widget snippet, or a container image.
- Releases are immutable (ADR-002). Rollback is deploying an earlier release,
  never mutating a current one.
- One image, every target (§11.1). No generator per cloud.
- The widget renders only the allow-listed output-block protocol (§4.4,
  ADR-005). No publisher code runs on a customer's page.

**Known debt, already recorded, do not rediscover it:**

- The generated `server.mjs` duplicates the origin matcher, wire protocol, and
  observability emitter as plain JavaScript, because the bundle must run on a
  bare Node image with no `@larkup/*` dependency. Tests assert equivalence.
  Fixed properly when `agent-contracts` ships a built artifact.
- Channel sessions, the idempotency store, rate-limit buckets, and the scoped
  API key table all want the same durable store. Build them once on the
  control-plane Postgres in TASK 09 — not four separate solutions. The
  idempotency one is the sharpest: two replicas will each answer the same
  Telegram message once.
- `authMode: "api-key"` fails closed with `501` until that key store exists.
  This is deliberate; do not "fix" it by accepting any key.

## When you are done

Update `plan.md` status markers on the sections you actually closed — the markers
are a claim about tested state, not about effort spent. If a target's acceptance
matrix did not run, it stays 🟡 and you say so.
