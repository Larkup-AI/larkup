# Video benchmark controller API v1 — local dashboard handoff

Implemented contract for the **Video Intelligence tool benchmark**, 2026-11-14.
The standalone controller is in `harness/`; the separately implemented dashboard
uses this API through its server-side BFF. See [the implementation plan](implementation-report.md).

## Ownership, location and transport

- Dashboard code: `packages/marketplace-tools/video-intelligence/benchmarks/dashboard/`
  in the canonical `larkup` repository. The controller/harness lives alongside it
  under this package's `benchmarks/harness/`; no Cloud repository implementation.
- Runs on the user's PC, with a configurable free local port. No Vercel.
- Benchmark agent owns the backend, CLI, execution, schemas and scientific
  protocol. Dashboard agent owns UI/client/mocks only; it never reads
  `packages/marketplace-tools/video-intelligence/benchmarks/benchmark.env` or calls providers directly.
- Backend binds to RunPod loopback/private network. PC uses SSH local forwarding;
  illustrative controller URL `http://127.0.0.1:28890`, remote port `8890`.
  Port numbers are configurable; verify exact listeners rather than bypass a
  repository port guard. Never point this at the main Larkup API.
- A local Next.js server/BFF keeps `BENCHMARK_CONTROLLER_TOKEN` server-side and
  proxies approved API operations to `BENCHMARK_CONTROLLER_URL`. Browser gets
  neither controller nor provider credentials. No login screen is necessary.
- Local UI and controller require loopback binding, exact Origin checks for
  mutations and server-side authorization. Localhost alone is not authorization;
  reject cross-origin writes and unsupported content types. No wildcard CORS.
- The dashboard may show a readonly last-synced export when the Pod is stopped;
  disable writes and label it offline/stale. It does not become another scheduler.

The prefix is `/api/v1`. Requests/responses are UTF-8 JSON except CSV exports and
optional SSE. Timestamps are ISO-8601 UTC; durations use **milliseconds**, source
positions use **milliseconds from original source start**. IDs, revisions and
event cursors are opaque strings. Monetary amounts are decimal strings, not
binary floats; currency is explicit. Unknown values are null with a reason.

```ts
type RunState =
  | 'draft'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'blocked'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed';
type TaskState =
  | 'pending'
  | 'ready'
  | 'leased'
  | 'submitted'
  | 'running'
  | 'waiting_quota'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';
type Decision = 'not_evaluated' | 'continue' | 'stop' | 'inconclusive';
type Phase = 'smoke' | 'pilot' | 'publication' | 'ablation';
type Role = 'audio' | 'brain' | 'index_vision' | 'refinement_vision' | 'answer';
type Cost = {
  currency: string;
  actual: string | null;
  estimated: string | null;
  unknownAttemptCount: number;
  reconciled: boolean;
};
type Issue = {
  code: string;
  scopeId: string | null;
  message: string; // sanitized; no raw provider payload/secret URL
  retryable: boolean;
  nextEligibleAt: string | null;
};
```

`completed` means the declared run tasks/evaluation/export requirements are
satisfied; it does not mean Larkup won. A run can finish with a pilot decision
`stop`. If declared core cells remain quota-blocked, it is `blocked`/partial,
not successfully complete. Config revisions and scientific variants are distinct
from a funding-route change. All list endpoints use cursor pagination.

## Endpoints

| Method / path                                                     | Contract                                                                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                                     | API version, controller build/schema version, availability, server time; no provider keys                                     |
| `GET /runs?cursor=&limit=`                                        | Paginated sanitized summaries, newest first                                                                                   |
| `POST /runs`                                                      | Create draft from a validated dataset manifest ID, variant IDs, phase and protocol revision; no arbitrary shell commands/URLs |
| `GET /runs/{id}`                                                  | Run snapshot, counters, decision, coverage, cost, blockers and current event cursor                                           |
| `POST /runs/{id}/start`                                           | Schedule its immutable task DAG after admission checks                                                                        |
| `POST /runs/{id}/pause`                                           | Stop new dispatch; return `pausing` while requests drain                                                                      |
| `POST /runs/{id}/resume`                                          | Resume eligible tasks without duplicate completed work                                                                        |
| `POST /runs/{id}/cancel`                                          | Best-effort cancel; accepted remote work may still complete and bill                                                          |
| `GET /runs/{id}/tasks?state=&provider=&sourceId=&cursor=&limit=`  | Task/attempt progress and sanitized issues                                                                                    |
| `GET /runs/{id}/results?variantId=&durationGroup=&cursor=&limit=` | Per-question answers/scores/usage/timing and provenance                                                                       |
| `GET /runs/{id}/metrics`                                          | Accuracy, paired wins/losses, per-duration metrics, coverage, cost and timing with denominators                               |
| `GET /runs/{id}/events?after=&limit=&waitMs=`                     | Ordered resumable events; short polling initially                                                                             |
| `GET /runs/{id}/exports/results.csv`                              | Stable sanitized CSV; Content-Disposition filename and checksum/ETag                                                          |
| `GET /provider-scopes`                                            | Account aliases, capabilities, balance/quota observations, cooldown and route health                                          |
| `GET /config`                                                     | Active sanitized profiles, routing policy and revision; no env values                                                         |
| `POST /config/validate`                                           | Validate profile/route changes or reload staged secret references; no activation                                              |
| `POST /config/activate`                                           | Atomically activate validated revision for future dispatches only                                                             |
| `POST /provider-scopes/{id}/refresh`                              | Deduplicated allowed metadata refresh; no benchmark question submission                                                       |

Bootstrap account secrets/staging files through the CLI or secure SSH upload,
not through a generic browser env editor. Config endpoints accept secret aliases
and predefined profile fields only. The dashboard cannot create accounts, buy
credits, increase rental commitments or substitute scientific models silently.
The controller decides route eligibility and pause/drain behavior.

Every state-changing request requires authorization, `Content-Type:
application/json`, `Idempotency-Key` and an `expectedRevision` where a resource
already exists. The idempotency key is scoped to operation/resource and canonical
body hash. Same key/body returns the original accepted result; different body is 409. Rapid double clicks must not start duplicate runs or retry billable tasks.

### Run snapshot

```json
{
  "id": "run-pilot-01",
  "revision": "12",
  "phase": "pilot",
  "state": "running",
  "decision": "not_evaluated",
  "protocolRevision": "protocol-pilot-v1",
  "datasetManifestId": "manifest-pilot-v1",
  "configRevision": "config-03",
  "startedAt": "2026-11-14T12:00:00Z",
  "updatedAt": "2026-11-14T12:01:00Z",
  "taskCounts": { "completed": 4, "running": 2, "pending": 12, "blocked": 1 },
  "coverage": {
    "plannedQuestions": 24,
    "plannedVariants": 4,
    "completedPairs": 8,
    "sharedCompletedQuestions": 1
  },
  "cost": {
    "currency": "USD",
    "actual": "0.18",
    "estimated": "0.24",
    "unknownAttemptCount": 1,
    "reconciled": false
  },
  "blockers": [],
  "eventCursor": "41"
}
```

This is illustrative mock data, not a measured result. Task counts are sparse:
absent states mean zero. A pair means one question/variant, not a provider
retry. `actual` and `estimated` are different accounting views, not additive.
Free provider allowance and RunPod compute/storage are separate metric objects
in detailed responses, never folded into paid API cash without provenance.

### Result object and timing

Each result includes: `runId`, `sourceId`, `dataset`, `questionId`, `variantId`,
`attemptId`, `configRevision`, `durationGroup`, `sourceDurationMs`,
`logicalModel`, `resolvedModel`, `routeId`, `provider`, `accountAlias`, `tier`,
`state`, `answer`, `predictedOption`, `correct` (boolean/null),
`evaluationRevision`, `evidence`, `cost`, `timing`, `usage`, `issue`.

Evidence entries contain source ID, original-clock `startMs/endMs`, kind and
supported-claim text where safe. Do not expose filesystem paths or full source
media via a generic file endpoint. Gold answers/evidence need not be served in
the live view; sealed evaluators keep them separate from answering contexts.

Timing fields: `queueMs`, `prepareMs`, `uploadMs`, `indexMs`, `answerMs`,
`firstTokenMs`, `endToEndMs`, `inputReuse` and `measurementProfileId`. Nullable
timings include an unavailable reason; native services may have no index stage.
Per-source indexing metrics are referenced by an index artifact ID rather than
summed once for every question. Retries retain their own costs/times.

Metrics include `denominator`, `completedCount`, `plannedCount` and filter/
cohort identifiers. An accuracy value without its denominator is invalid.
Paired metrics identify the exact compared variants and completed source cohort.
Do not turn null accuracy/TTFT into zero or hide blocked examples in the UI.

### Events, reconnect and progress

```json
{
  "events": [
    {
      "id": "42",
      "type": "task.updated",
      "runId": "run-pilot-01",
      "occurredAt": "2026-11-14T12:01:03Z",
      "revision": "13",
      "data": { "taskId": "task-04", "state": "waiting_quota" }
    }
  ],
  "nextCursor": "42",
  "hasMore": false
}
```

Types: `run.updated`, `task.updated`, `attempt.completed`, `usage.updated`,
`quota.updated`, `route.changed`, `config.activated`, `evaluation.updated`,
`export.ready`, `issue.raised`. Keep payloads small and sanitized. Persist events
before exposing their IDs; order by cursor, not wall-clock timestamp. Delivery
is at-least-once: clients deduplicate IDs and refresh snapshots after gaps.

Use 2-second polling initially and bounded page sizes; `waitMs` can be omitted.
No long poll may block control requests. Optional SSE later must support the
same IDs/Last-Event-ID and reconnect behavior. An expired cursor returns 410
with a snapshot URL; client reloads the snapshot then continues from its cursor.
Display raw provider stage/percent when known, with unknown progress explicitly
indeterminate. A task reaching 100% is not the whole run reaching completion.

## Config activation and scientific integrity

`validate` returns an opaque `candidateId`, sanitized diff, validation issues,
`requiresDrain`, and `baseRevision`. Activation accepts the candidate plus the
expected base revision. Return 409 on a stale revision/candidate. Keep the old
active snapshot when validation fails. Secret candidate storage is private and
short-lived; activation events contain no key values or hashes usable as tokens.

New keys for the same allowed exact model can serve future work. Model/version,
sampling, modality or retrieval changes create a new immutable variant and an
explicit cache-impact record. Changes never rewrite completed results. Startup-
only settings return `requiresDrain: true` and an actionable status; don't claim
an env file edit reconfigured a process that cached settings on startup.

## Error envelope and HTTP status

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "Run state changed; refresh.",
    "retryable": false,
    "nextEligibleAt": null,
    "requestId": "req-01"
  }
}
```

200 normal reads/idempotent retrieval; 201 draft created; 202 accepted controls;
400 malformed input; 401/403 authorization; 404 unknown resource; 409 revision/
state/idempotency conflict; 410 expired cursor; 422 invalid config; 429 controller
request limit; 503 controller unavailable. A **provider** 429 normally updates
its task/quota state; it is not an HTTP failure of `GET /runs/{id}`.

Known domain codes: `QUOTA_WAIT`, `CREDIT_EXHAUSTED`, `AUTH_INVALID`,
`MODEL_UNAVAILABLE`, `CAPABILITY_UNSUPPORTED`, `REMOTE_OUTCOME_UNKNOWN`,
`CONFIG_INVALID`, `SOURCE_UNAVAILABLE`, `EVALUATION_INVALID`, `INFRA_FAILURE`.
No raw upstream exception/headers may pass through this envelope.

## Parallel dashboard-agent acceptance criteria

Build with mocks for running, pausing, paused, quota-blocked, mixed-route,
offline, partial-results, negative-pilot and completed states. The page needs
run controls, progress by provider/source, accuracy with denominators, duration
groups, cost/allowance state, index/answer timing, sanitized issues and CSV export.
Prefer clear tables and a few useful comparisons over elaborate charts.

The dashboard agent must not implement model routing, scheduler correctness,
provider billing logic or evaluation. Use the backend fields; surface unknowns.
Backend and UI share contract fixtures/schemas when implementation exists;
neither agent should independently redefine status, units or cost semantics.
Coordinate contract changes with a versioned diff and fixture updates.

Required contract checks: idempotent controls, stale revision, auth/Origin,
redaction, empty lists, null metrics, event dedup/reconnect, offline readonly
mode, and pause draining. Benchmark agent supplies backend contract tests;
dashboard agent supplies meaningful UI/client tests. No dashboard implementation
or deployment is part of the current documentation task.


## Implemented controller details

The API remains `v1`; the internal SQLite schema revision is 3. The launcher
binds the dashboard to `127.0.0.1:3100`, the SSH-forwarded controller to
`127.0.0.1:28890`, and an authenticated server-to-server BFF relay to
`127.0.0.1:28891`. That relay supplies the controller's exact mutation Origin.
The dashboard's controller URL is the relay origin, without `/api/v1`.
Existing provider credentials remain on the PC, behind a separate private SSH
reverse tunnel; they are never dashboard configuration or browser data.

Controls require revision and body-hash idempotency. Config validation candidates
expire; activation persists the active snapshot. Startup role changes require a
drain/restart. Provider metadata refresh is asynchronous (202) and never submits
billable inference. A key suffix is not proof of an independent quota.

`coverage.sharedCompletedQuestions` counts questions completed across declared
core variants; unplanned ablation cells do not reduce that cohort.
`metrics.providerUsage` separates observed cash, estimates and unknown records.
Index times, attempts and usage have separate CSV exports. Unobserved timings
remain null.

When SSH is unavailable, the BFF relay serves the verified local SQLite backup
in readonly mode. Health returns `availability: "offline"`, `readonly: true`
and `lastSyncedAt`. Mutations return 409 `OFFLINE_READONLY` with no dispatch.
The dashboard stays in proxy mode for real saved results; its mock/offline fixture
mode is not used for measurements. Clients should use controller health to label
stale snapshots and disable controls.

The saved engineering smoke passed on the isolated GPU. Frozen pilot metadata
is under `data/`; consult the saved run snapshot for actual execution state.

### Additive metrics and chart exports

Results and tasks include `system`: `larkup`, `retrieval`, `gemini`, `qwen`, or
`twelvelabs`. Use this for the provider/system selector in the UI: `provider`
identifies the funding transport (for example `gateway`), so several systems
can share it. Tasks accept `system` and `variantId` filters in addition to the
existing filters. Results also accept `system`, `provider`, `state`, and
`sourceId`. These fields and filters are additive in v1.

`metrics.summary` has one row per immutable variant: `system`, `plannedCount`,
`completedCount`, `correctCount`, `incorrectCount`, `blockedCount`, `stateCounts`,
`accuracy` with denominator, and three `Cost` objects: `cost` (all attempts),
`preparationCost`, and `questionCost`. Preparation is counted once through its
ledger entries. The original run snapshot `cost` remains the total across all
variants. Null and partial costs retain the existing unknown-charge semantics.

Each result's `cost` is the final attempt's cost; `taskCost` includes every
attempt for that question, including failures and retries. Neither includes
the separately recorded source preparation cost. `timing.coldFirstAnswerMs`
is source preparation plus the first answer's observed response time; it is
null on later reused-source answers. `inputReuse` distinguishes these cases.
Queue time remains separate. Historical records without those observations
remain null; they are not backfilled with invented measurements.

The authenticated CSV export route additionally supports `questions.csv`,
`summary.csv`, `usage.csv`, `attempts.csv`, `indexes.csv`, `metrics.csv`,
`timing.csv`, `provider-usage.csv`, and `paired.csv`. Each uses the same
`/runs/{id}/exports/{filename}` path, checksum header and safe spreadsheet
escaping as `results.csv`. `questions.csv` flattens timing, usage, attempt cost
and retry-inclusive task cost into columns; `summary.csv` flattens the per-system
comparison. `usage.csv` includes immutable reconciliation receipts when present.
The original nested `results.csv` remains compatible. These extra exports are
also saved under the report's `data/` directory.


### Operator, database, logs and JSON additions

These endpoints are additive in v1. The PC bridge owns `/system` and `/system/*`;
the remote controller owns inspection of its benchmark database and runtime.

| Method / path | Response / effect |
|---|---|
| GET `/system` | `revision`, `readonly`, `controllerAvailable`, observed `pod`, `supervisor`, `services`, latest `operations` |
| POST `/system/start` | Resume the saved Pod/transports and smoke-to-pilot workflow; never rent an additional Pod |
| POST `/system/pause` | Pause workflow admission and all running runs |
| POST `/system/resume` | Resume existing paused runs |
| POST `/system/stop-gpu` | Pause, drain, backup, stop compute |
| POST `/system/force-stop-gpu` | Emergency stop after `confirmation: "STOP GPU"`; no final drain/backup |
| GET `/services` | Controller and canonical runtime/operator metadata; no inference probe |
| GET `/database/tables` | Allowlisted table names, columns and row counts |
| GET `/database/{table}` | Readonly `items`, `columns`, `nextCursor`, `hasMore`; optional `runId`, cursor and limit (max 200) |
| GET `/database/{table}/export.json` | Redacted table JSON, max 100,000 rows; larger tables require pagination |
| GET `/runs/{id}/exports/results.json` | Complete snapshot, metrics, results, tasks and usage for the run |
| GET `/logs?service=…&cursor=…&limit=…` | Redacted lines (`id`, `text`), byte `nextCursor`, `hasMore`, `reset`, `available` |

Operator mutations require `expectedRevision`, the existing Content-Type/Origin
and server bearer guards, and an Idempotency-Key. They return 202 with an
operation ID/state; poll `/system` for completion or failure. Force stop may
supersede another pending action. Run controls retain their existing semantics.
GETs never start a Pod or submit inference. Readonly mode rejects all mutations.

Log services are `operator`, `controller`, `runtime`, `bootstrap`, `relay`,
`dashboard`, `tunnel`; arbitrary paths are rejected. Missing remote logs are
explicitly unavailable, or marked as saved snapshots. JSON and CSV exports keep
null correctness/cost distinct from zero. Stored documents are parsed for display
and scrubbed; sealed gold fields and credentials are excluded even from raw-row
inspection. Tasks additionally expose the latest stored `progress` and
`progressObservedAt`; unobserved stage/percent remain null.

The current development pilot is partial and paused: two Qwen answers on one
long video completed, one correct and one incorrect. Infrastructure failures
have null correctness; this is not a completed comparative accuracy result.


## Explicit experiments and simple home (v1 additive extension)

The default Home presents Larkup, Gemini, Qwen and TwelveLabs with nullable score,
correct/answered denominator, answered/planned coverage, state, known API cash
and response time. Retrieval ablation and technical panels remain in Advanced.
Home always labels saved checkpoints and timestamps the last actual API checks;
a provider metadata/credit response is not proof of video-answer functionality.

`GET /system` additionally returns `selectedRunId: string | null` and nullable
`readiness: {checkedAt, checks:[{system,route,state,completedAnswers,note}],
limitations:string[]}`. Readiness records tiny actual checks and their scope;
indexing on a previous cached artifact is explicitly distinct from new GPU work.
The UI follows a changed selectedRunId once. Browsing history does not repeatedly
jump back to the current run. Responses from an older selection cannot replace
newer selected-run content.

`POST /system/new-run` creates and starts a distinct frozen pilot after smoke
certificates and active-run admission checks. Existing history is preserved.
`POST /system/resume-run` requires `runId` and starts/resumes exactly that run.
Both require the system expectedRevision and Idempotency-Key and return the same
202 operation schema as other operator actions. A completed operation has
`result: {runId,state,phase}`. Completed/cancelled runs cannot be resumed.
`POST /system/resume` now refers only to the explicitly selected experiment;
it does not resume every paused historical run. An active competing run is 409
`ANOTHER_RUN_ACTIVE_PAUSE_IT_FIRST`, with no GPU/transport interruption.

CLI equivalents are `./launch.sh new` and `./launch.sh resume-run RUN_ID`. With an
existing launcher, these commands submit through its private authenticated
operator bridge, print the created/selected ID, and monitor progress. A browser
already open on Home selects the new run automatically. Neither route expands
past the pilot continue/stop/inconclusive gate.

Real data is now the default. `DASHBOARD_MODE=mock` is required for fixtures;
`offline` also proxies the actual readonly PC snapshot bridge and never supplies
illustrative scores. The inline native Gemini transport rejects media above
100 MB before paid submission and records `NATIVE_INLINE_INPUT_LIMIT`; a
configured task deadline also governs native Gateway and async answer polling.
